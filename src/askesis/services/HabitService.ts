/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * @file services/HabitService.ts
 * @description Motor de Operações Binárias para Logs de Hábitos (Esquema 9-bit / Tombstone).
 */

import { state, PERIOD_OFFSET, TimeOfDay, bumpStateGeneration } from '../state';
import { logger } from '../utils';

/** 31 dias * 3 períodos = 93 blocos de 3 bits. */
const BLOCKS_PER_MONTH = 93n;

/** 31 * 9 = 279 bits -> 70 dígitos hexadecimais. */
const MAX_LOG_HEX_DIGITS = 70;

export class HabitService {

    // --- LAZY SHARDING CACHE ---
    // Armazena as strings serializadas (Hex) agrupadas por mês.
    // Evita reprocessar meses que não sofreram alterações.
    private static shardCache = new Map<string, [string, string][]>();
    
    // Rastreia quais meses foram tocados desde o último sync/geração.
    private static dirtyMonths = new Set<string>();

    /**
     * Limpa o cache completamente.
     * Deve ser chamado sempre que o estado global (state.monthlyLogs) for substituído (ex: Load/Import).
     */
    static resetCache() {
        this.shardCache.clear();
        this.dirtyMonths.clear();
    }

    private static markDirty(month: string) {
        this.dirtyMonths.add(month);
    }

    private static getLogKey(habitId: string, dateISO: string): string {
        return `${habitId}_${dateISO.substring(0, 7)}`; // ID_YYYY-MM
    }

    /**
     * Serializa um bitmask mensal. Formato canônico: hexadecimal com prefixo `0x`.
     */
    static serializeLogValue(value: bigint): string {
        return '0x' + value.toString(16);
    }

    /**
     * Parser canônico de bitmask mensal — inverso de `serializeLogValue`.
     *
     * Aceita todas as representações que circulam no app:
     *   - `bigint` / `number` (já em memória)
     *   - hex com ou sem prefixo `0x` (shards da nuvem levam prefixo; o binário
     *     do IndexedDB é gravado sem)
     *   - `{ __type: 'bigint', val: '<decimal>' }`, produzido pelo `sync.worker`
     *
     * Retorna `null` em vez de lançar, para que uma entrada corrompida não
     * derrube o mês inteiro. Usar sempre isto — parsers ad-hoc já divergiram
     * quanto ao prefixo e ao limite de tamanho.
     */
    static parseLogValue(value: unknown): bigint | null {
        if (typeof value === 'bigint') return value;

        if (typeof value === 'number') {
            if (!Number.isSafeInteger(value) || value < 0) return null;
            return BigInt(value);
        }

        if (value && typeof value === 'object') {
            const obj = value as Record<string, unknown>;
            // O worker serializa em decimal (`bigint.toString()`), não em hex.
            if (obj['__type'] === 'bigint' && typeof obj['val'] === 'string') {
                return /^\d+$/.test(obj['val']) ? BigInt(obj['val']) : null;
            }
            return null;
        }

        if (typeof value !== 'string' || value === '') return null;

        const digits = /^0x/i.test(value) ? value.slice(2) : value;
        if (!/^[0-9a-f]+$/i.test(digits)) return null;
        if (digits.length > MAX_LOG_HEX_DIGITS) return null;

        return BigInt('0x' + digits);
    }

    /**
     * Reconstrói o Map de logs a partir de qualquer forma serializada
     * (Array de entries ou objeto). Entradas inválidas são descartadas
     * individualmente, com aviso.
     */
    static deserializeLogs(source: unknown): Map<string, bigint> {
        const result = new Map<string, bigint>();
        if (!source || typeof source !== 'object') return result;

        // `Object.entries` de um Map devolve [], o que apagaria os logs em silêncio.
        const entries: [string, unknown][] = source instanceof Map
            ? Array.from(source.entries())
            : Array.isArray(source)
                ? source as [string, unknown][]
                : Object.entries(source as Record<string, unknown>);

        for (const [key, raw] of entries) {
            const parsed = this.parseLogValue(raw);
            if (parsed === null) {
                logger.warn(`[Logs] Valor de bitmask inválido para "${key}", entrada descartada.`);
                continue;
            }
            result.set(key, parsed);
        }
        return result;
    }

    /**
     * Leitura Otimizada com lógica de Lápide (Tombstone).
     * Se o bit de lápide (bit 2 do bloco de 3) for 1, o status é forçado para NULL (0).
     */
    static getStatus(habitId: string, dateISO: string, time: TimeOfDay): number {
        const key = this.getLogKey(habitId, dateISO);
        const log = state.monthlyLogs?.get(key);
        
        if (log !== undefined) {
            const day = parseInt(dateISO.substring(8, 10), 10);
            const bitPos = BigInt(((day - 1) * 9) + PERIOD_OFFSET[time]);
            const block = (log >> bitPos) & 7n; // Lê o bloco de 3 bits
            
            // Verifica bit de Lápide (Exclusão)
            if ((block >> 2n) & 1n) return 0; 
            
            return Number(block & 3n); // Retorna os 2 bits de status
        }
        return 0;
    }

    /**
     * Escrita Otimizada. 
     * Ao definir como NULL (0), ativa o bit de Lápide para propagar a exclusão.
     */
    static setStatus(habitId: string, dateISO: string, time: TimeOfDay, newState: number) {
        if (!state.monthlyLogs) state.monthlyLogs = new Map();

        const key = this.getLogKey(habitId, dateISO);
        const day = parseInt(dateISO.substring(8, 10), 10);
        
        const bitPos = BigInt(((day - 1) * 9) + PERIOD_OFFSET[time]);
        const clearMask = ~(7n << bitPos); // Máscara para limpar 3 bits
        
        let currentLog = state.monthlyLogs.get(key) || 0n;
        
        let valToStore = 0n;
        if (newState === 0) {
            // Caso especial: Exclusão manual (Undo)
            // Define Tombstone=1 e Status=00 -> Binário 100 -> Decimal 4
            valToStore = 4n; 
        } else {
            // Registro normal: Tombstone=0 e Status=newState
            valToStore = BigInt(newState);
        }
        
        const newLog = (currentLog & clearMask) | (valToStore << bitPos);
        
        state.monthlyLogs.set(key, newLog);
        
        // LAZY SHARDING: Marca o mês como sujo
        this.markDirty(dateISO.substring(0, 7));
        
        bumpStateGeneration();
    }

    /**
     * EXPURGO PROFUNDO (Hard Delete).
     * Remove fisicamente todas as entradas de log associadas a um ID de hábito.
     * Isso libera memória e garante que "Apagar" realmente signifique apagar o histórico.
     */
    static pruneLogsForHabit(habitId: string) {
        if (!state.monthlyLogs) return;
        
        const prefix = habitId + '_';
        // As chaves são compostas por "ID_ANO-MES".
        for (const key of state.monthlyLogs.keys()) {
            if (key.startsWith(prefix)) {
                // Extrai o mês (parte final após o ID) para marcar como dirty
                // ID pode conter underscores, mas o formato é sufixado por _YYYY-MM (7 chars)
                const month = key.slice(-7);
                this.markDirty(month);
                
                state.monthlyLogs.delete(key);
            }
        }
        bumpStateGeneration();
    }

    /**
     * Agrupa logs por mês para criação de shards granulares.
     * IMPLEMENTAÇÃO LAZY: Só regenera shards para meses marcados como 'dirty'.
     */
    static getLogsGroupedByMonth(): Record<string, [string, string][]> {
        // Se o mapa principal estiver vazio ou nulo, limpa tudo.
        if (!state.monthlyLogs || state.monthlyLogs.size === 0) {
            this.resetCache();
            return {};
        }

        // FAST PATH: Se nada mudou e temos cache, retorna o cache diretamente.
        if (this.dirtyMonths.size === 0 && this.shardCache.size > 0) {
            return Object.fromEntries(this.shardCache);
        }

        const tempRegen = new Map<string, [string, string][]>();

        // Varredura para regenerar apenas o necessário
        // Nota: Iterar sobre o mapa é rápido; a serialização (toString(16)) é que é custosa.
        for (const [key, val] of state.monthlyLogs.entries()) {
            const month = key.slice(-7); // Extrai YYYY-MM
            
            // Só processa se o mês estiver sujo OU se não estiver no cache (primeira execução)
            if (this.dirtyMonths.has(month) || !this.shardCache.has(month)) {
                if (!tempRegen.has(month)) tempRegen.set(month, []);
                tempRegen.get(month)!.push([key, this.serializeLogValue(val)]);
            }
        }

        // Atualiza o Cache
        // 1. Adiciona/Atualiza meses regenerados
        for (const [month, data] of tempRegen) {
            this.shardCache.set(month, data);
        }
        
        // 2. Remove do cache meses que estavam sujos mas não existem mais no mapa (foram deletados)
        for (const month of this.dirtyMonths) {
            if (!tempRegen.has(month)) {
                this.shardCache.delete(month);
            }
        }

        this.dirtyMonths.clear();
        return Object.fromEntries(this.shardCache);
    }

    /**
     * Agrupamento a partir de snapshot (sem cache e sem dependência do state global).
     * Útil para sincronização, onde precisamos garantir consistência usando um AppState clonado.
     */
    static groupLogsByMonthSnapshot(logs: Map<string, bigint> | undefined | null): Record<string, [string, string][]> {
        if (!logs || logs.size === 0) return {};

        const grouped: Record<string, [string, string][]> = Object.create(null);
        for (const [key, value] of logs.entries()) {
            const month = key.slice(-7);
            if (!grouped[month]) grouped[month] = [];
            grouped[month].push([key, this.serializeLogValue(value)]);
        }
        return grouped;
    }

    /**
     * Serialização para Cloud (Hexadecimal).
     * Usa a lógica cacheada de getLogsGroupedByMonth para eficiência.
     */
    static serializeLogsForCloud(): [string, string][] {
        const grouped = this.getLogsGroupedByMonth();
        return Object.values(grouped).flat();
    }

    /**
     * Resolve dois bitmasks mensais bloco a bloco (LWW-Register com união em ausência).
     *
     *   - Bloco do vencedor preenchido (status OU lápide) -> vence.
     *   - Bloco do vencedor vazio (000 = "nunca toquei")  -> herda o do perdedor.
     *
     * A lápide (100) é apenas mais um valor com timestamp, e não uma prioridade
     * incondicional: isso preserva a união de edições offline em slots disjuntos
     * sem deixar uma lápide antiga engolir uma re-marcação mais recente.
     *
     * Nunca usar `winner | loser`: o OR combina bits de blocos distintos e
     * fabrica estados inválidos (DONE 001 | DEFERRED 010 = DONE_PLUS 011).
     */
    static mergeLogValues(winnerVal: bigint, loserVal: bigint): bigint {
        if (winnerVal === loserVal) return winnerVal;

        let mergedVal = 0n;
        for (let i = 0n; i < BLOCKS_PER_MONTH; i++) {
            const shift = i * 3n;
            const winnerBlock = (winnerVal >> shift) & 7n;
            const finalBlock = winnerBlock !== 0n ? winnerBlock : (loserVal >> shift) & 7n;

            mergedVal |= (finalBlock << shift);
        }
        return mergedVal;
    }

    /**
     * INTELLIGENT MERGE (CRDT-Lite para Bitmasks).
     * O vencedor é o estado com `lastModified` mais recente (ver `mergeStates`).
     */
    static mergeLogs(winnerMap: Map<string, bigint> | undefined, loserMap: Map<string, bigint> | undefined): Map<string, bigint> {
        const result = new Map<string, bigint>(winnerMap || []);
        if (!loserMap) return result;

        for (const [key, loserVal] of loserMap.entries()) {
            result.set(key, this.mergeLogValues(result.get(key) || 0n, loserVal));
        }
        return result;
    }

    static clearAllLogs() {
        state.monthlyLogs = new Map();
        this.resetCache();
        bumpStateGeneration();
    }
}