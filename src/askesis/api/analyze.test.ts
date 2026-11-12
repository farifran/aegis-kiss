import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateContentMock = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      generateContent: generateContentMock
    };
    constructor(_args: unknown) {}
  }
}));

function makeAnalyzeRequest(prompt = 'hello', systemInstruction = 'sys') {
  return new Request('https://askesis.vercel.app/api/analyze', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'origin': 'https://askesis.vercel.app',
      'x-vercel-forwarded-for': '203.0.113.10'
    },
    body: JSON.stringify({ prompt, systemInstruction })
  });
}

describe('api/analyze quota cooldown', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.API_KEY = 'test-key';
    process.env.CORS_ALLOWED_ORIGINS = 'https://askesis.vercel.app';
    process.env.CORS_STRICT = '1';
    process.env.DISABLE_RATE_LIMIT = '1';
    process.env.AI_QUOTA_COOLDOWN_MS = '120000';
  });

  it('chama o modelo padrão gemini-3.5-flash-lite sem parâmetros depreciados e com config nativo', async () => {
    generateContentMock.mockResolvedValueOnce({ text: '{"ok":true}' });

    const mod = await import('./analyze');
    await mod.default(makeAnalyzeRequest('p', 's'));

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    const args = generateContentMock.mock.calls[0][0];
    expect(args.model).toBe('gemini-3.5-flash-lite');
    expect(args.contents).toBe('p');
    expect(args.config.systemInstruction).toBe('s');
    expect(args.config).not.toHaveProperty('temperature');
    expect(args.config).not.toHaveProperty('topP');
    expect(args.config).not.toHaveProperty('topK');
  });

  it('adapta prompt injetando systemInstruction quando configurado com modelo Gemma', async () => {
    process.env.AI_MODEL_NAME = 'gemma-4-26b-a4b-it';
    generateContentMock.mockResolvedValueOnce({ text: '{"ok":true}' });

    const mod = await import('./analyze');
    await mod.default(makeAnalyzeRequest('p', 's'));

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    const args = generateContentMock.mock.calls[0][0];
    expect(args.model).toBe('gemma-4-26b-a4b-it');
    expect(args.contents).toContain('[INSTRUÇÕES DO SISTEMA / SÁBIO ESTOICO]:\ns');
    expect(args.contents).toContain('[DADOS DO USUÁRIO]:\np');
    expect(args.config).not.toHaveProperty('systemInstruction');
  });

  it('ativa saída estruturada quando o cliente envia responseSchema', async () => {
    generateContentMock.mockResolvedValueOnce({ text: '{"ok":true}' });
    const schema = { type: 'object', properties: { a: { type: 'string' } } };

    const mod = await import('./analyze');
    await mod.default(new Request('https://askesis.vercel.app/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://askesis.vercel.app', 'x-vercel-forwarded-for': '203.0.113.10' },
      body: JSON.stringify({ prompt: 'p', systemInstruction: 's', responseSchema: schema })
    }));

    const cfg = generateContentMock.mock.calls[0][0].config;
    expect(cfg.responseMimeType).toBe('application/json');
    expect(cfg.responseSchema).toEqual(schema);
  });

  it('mantém resposta em prosa quando não há responseSchema (avaliação de hábitos)', async () => {
    generateContentMock.mockResolvedValueOnce({ text: '# Relatório' });

    const mod = await import('./analyze');
    await mod.default(makeAnalyzeRequest('p', 's'));

    const cfg = generateContentMock.mock.calls[0][0].config;
    expect(cfg).not.toHaveProperty('responseMimeType');
    expect(cfg).not.toHaveProperty('responseSchema');
  });

  it('ativa cooldown após erro de quota e bloqueia nova chamada ao provedor', async () => {
    generateContentMock.mockRejectedValueOnce(Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429 }));

    const mod = await import('./analyze');
    const handler = mod.default;

    const first = await handler(makeAnalyzeRequest('p1', 's1'));
    expect(first.status).toBe(429);

    const second = await handler(makeAnalyzeRequest('p2', 's2'));
    expect(second.status).toBe(429);

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    expect(second.headers.get('Retry-After')).toBeTruthy();
  });

  it('responde cache hit mesmo durante cooldown sem chamar provedor', async () => {
    generateContentMock.mockResolvedValueOnce({ text: 'cached answer' });
    generateContentMock.mockRejectedValueOnce(Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429 }));

    const mod = await import('./analyze');
    const handler = mod.default;

    const first = await handler(makeAnalyzeRequest('same', 'sys'));
    expect(first.status).toBe(200);

    const second = await handler(makeAnalyzeRequest('other', 'sys'));
    expect(second.status).toBe(429);

    const third = await handler(makeAnalyzeRequest('same', 'sys'));
    expect(third.status).toBe(200);
    expect(third.headers.get('X-Cache')).toBe('HIT');

    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });
});
