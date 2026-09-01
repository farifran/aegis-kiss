Preciso de um motor central de processamento de lotes de operações, responsável por receber uma sequência de comandos independentes, validar suas pré-condições, controlar recursos limitados, calcular os efeitos globais e aplicar o resultado de forma segura e determinística.

Cada operação deve possuir identificador, origem, destino, valor e custo. O sistema deve suportar múltiplas entidades com saldo próprio e um limite de capacidade consumível que se recompõe ao longo do tempo. Uma operação individual só pode ser aceita quando suas entradas forem válidas, as entidades existirem e estiverem aptas, houver capacidade disponível e o resultado não violar nenhuma restrição financeira.

O processamento deve considerar corretamente a composição de operações dentro do mesmo lote: recursos e saldos não podem ser verificados isoladamente de forma que duas operações individualmente válidas sejam aceitas quando sua soma excede a capacidade ou o saldo disponível. O resultado deve ser determinístico para o mesmo estado inicial, entrada e instante temporal.

A aplicação de um lote deve ser atômica: nenhuma alteração parcial pode permanecer caso qualquer efeito obrigatório do commit falhe ou caso uma invariante global seja violada. O sistema deve preservar explicitamente a capacidade de retornar ao estado anterior. Falhas devem produzir um resultado consistente, sem efeitos residuais invisíveis.

O motor deve também lidar explicitamente com o tempo. A evolução dos recursos dependentes de tempo deve possuir uma política definida para relógios iguais, avançando ou regressando, sem permitir criação artificial de capacidade ou comportamento temporal ambíguo.

Após cada processamento, o sistema deve expor um resultado observável contendo quantidades aceitas, rejeitadas, bloqueadas, volume processado, custos acumulados, indicador de rollback e uma representação determinística da execução. Esse resultado deve permanecer consistente com o estado interno observável após a conclusão.

A implementação deve manter invariantes globais verificáveis, incluindo conservação de valor, ausência de saldos negativos, impossibilidade de consumo acima da capacidade disponível, consistência entre resultado e estado, atomicidade de falhas e isolamento entre execuções sucessivas.

A solução deve ser implementada em TypeScript, seguindo KISS, com interfaces explícitas, dependências mínimas e sem infraestrutura externa. O objetivo principal não é apenas produzir código funcional, mas servir como uma demanda suficientemente rica para testar integralmente o Aegis como harness: descoberta da realidade, interpretação de requisitos, geração de contrato, implementação, validação estrutural, validação semântica, provas de composição, atomicidade, temporalidade, consistência observável e detecção adversarial de falhas que só aparecem quando componentes aparentemente corretos interagem entre si.
