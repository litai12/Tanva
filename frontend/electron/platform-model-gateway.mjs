/** The shared desktop brain owns its credentials, never a product session. */
export class PlatformModelGateway {
  constructor({ getKey, fetchImpl = fetch, baseUrl = 'http://127.0.0.1:4455/v1' }) {
    this.getKey = getKey;
    this.fetch = fetchImpl;
    this.baseUrl = baseUrl;
  }

  async request(path, body, signal) {
    const key = await this.getKey();
    if (!key) throw new Error('请先在连接设置中配置 4455 API Key');
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method: body ? 'POST' : 'GET', redirect: 'error',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`4455 服务返回 HTTP ${response.status}${response.status === 401 ? '，请检查 API Key' : ''}`);
    return response.json();
  }

  async models() {
    const result = await this.request('/models');
    if (!Array.isArray(result.data)) throw new Error('4455 未返回有效模型列表');
    return [...new Set(result.data.map(item => item?.id).filter(id => typeof id === 'string' && id.trim()))]
      .sort().map(id => ({ id, label: id }));
  }

  async run({ model, messages, tools, callTool, signal, onProgress = () => {} }) {
    const models = await this.models();
    if (!models.some(item => item.id === model)) throw new Error(`4455 未提供模型 ${model}，请从实时列表选择`);
    const history = [...messages];
    for (let round = 0; round < 12; round++) {
      signal.throwIfAborted();
      const result = await this.request('/chat/completions', {
        model, messages: history, stream: false,
        ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
      }, signal);
      const choice = result.choices?.[0];
      const message = choice?.message;
      if (!message || typeof message !== 'object') throw new Error('模型未返回有效回复');
      if (choice.finish_reason === 'length') throw new Error('模型输出被截断，本次任务未完成');
      if (!message.tool_calls?.length) {
        if (typeof message.content !== 'string' || !message.content.trim()) throw new Error('模型返回了空回复');
        return { text: message.content, model };
      }
      history.push(message);
      for (const tool of message.tool_calls) {
        signal.throwIfAborted();
        if (!tools.some(item => item.function.name === tool.function?.name)) throw new Error('模型请求了未注册能力');
        onProgress(tool.function.name);
        let output;
        try {
          const args = JSON.parse(tool.function.arguments);
          output = await callTool(tool.function.name, args, signal);
        } catch (error) {
          signal.throwIfAborted();
          output = { error: error.message };
        }
        history.push({ role: 'tool', tool_call_id: tool.id, content: JSON.stringify(output) });
      }
    }
    throw new Error('本轮达到工具调用上限，任务尚未完成，请检查执行记录后继续');
  }
}
