/**
 * dsh-strip-thinking-tag
 *
 * 有些模型（本机观察到的是 neko / Ali/deepseek-v4.1-flash）偶尔会把一段思考
 * 小抄写进「正文」通道，形如：
 *
 *   {"type":"text","text":"<thinking>Let me read the spec doc.</thinking>真正的正文…"}
 *
 * DSH 收到什么就渲染什么，于是那一段就露在聊天里。本插件挂在 `llm/stream`
 * 瀑布上，把正文块开头的 `<thinking>…</thinking>` 摘掉（连内容一起丢）。
 *
 * 刻意只处理「块首」命中的情况（允许前导空白）：
 *   - 观察到的所有泄漏都是块首命中；
 *   - 正文中间出现的同名标签（例如回答里正在讨论这个标签本身）不会被误伤。
 *
 * 只改 `text` 通道。`reasoning` 通道一字不动——那里的标签是正常内容。
 */

const OPEN = '<thinking>';
const CLOSE = '</thinking>';

/**
 * 剥离正文块开头的 `<thinking>…</thinking>`。
 * @param {string} text - 完整的正文块文本。
 * @returns {string} 剥离后的文本；未命中时原样返回。
 */
export function stripLeadingThinking(text) {
	if (typeof text !== 'string' || text.length === 0) return text;
	const lead = text.length - text.trimStart().length;
	const body = text.slice(lead);
	if (!body.startsWith(OPEN)) return text;
	const end = body.indexOf(CLOSE);
	// 未闭合（流被截断）：整块都当思考丢掉。
	if (end === -1) return '';
	return body.slice(end + CLOSE.length);
}

/**
 * 流式剥离器：标签可能被切成多个 delta（`<thin` + `king>`），所以前缀阶段必须
 * 按住尾巴等下一片。与 stripLeadingThinking 对同一段文本给出相同结果。
 * @returns {{ push: (text: string) => string }} 每次喂入返回可以立刻上屏的部分。
 */
function createStripper() {
	let passed = false;
	let buffered = '';
	return {
		push(text) {
			if (passed) return text;
			buffered += text;
			const lead = buffered.length - buffered.trimStart().length;
			const body = buffered.slice(lead);
			// 还可能长成 OPEN：继续等。
			if (body.length === 0 || (body.length < OPEN.length && OPEN.startsWith(body))) return '';
			if (!body.startsWith(OPEN)) {
				passed = true;
				const out = buffered;
				buffered = '';
				return out;
			}
			const end = body.indexOf(CLOSE);
			if (end === -1) return '';
			passed = true;
			buffered = '';
			return body.slice(end + CLOSE.length);
		},
	};
}

/**
 * 过滤一条 LLM 分片流，只改写正文增量与正文块的最终内容。
 * @param {AsyncIterable<object>} source - 上游分片流。
 * @returns {AsyncIterable<object>} 过滤后的分片流。
 */
export async function* filterStream(source) {
	const strippers = new Map();
	for await (const chunk of source) {
		if (chunk !== null && typeof chunk === 'object' && chunk.type === 'text-delta' && typeof chunk.text === 'string') {
			let stripper = strippers.get(chunk.index);
			if (stripper === undefined) {
				stripper = createStripper();
				strippers.set(chunk.index, stripper);
			}
			const text = stripper.push(chunk.text);
			if (text.length > 0) yield { ...chunk, text };
			continue;
		}
		if (chunk !== null && typeof chunk === 'object' && chunk.type === 'block-end' && chunk.block !== null && typeof chunk.block === 'object' && chunk.block.type === 'text') {
			strippers.delete(chunk.index);
			const text = stripLeadingThinking(chunk.block.text);
			yield text === chunk.block.text ? chunk : { ...chunk, block: { ...chunk.block, text } };
			continue;
		}
		yield chunk;
	}
}

export const name = 'strip-thinking-tag';

/** 挂在 llm 流分发瀑布上；`next()` 返回上游的异步分片流。 */
export function apply(ctx) {
	ctx.on('llm/stream', (_options, next) => {
		if (typeof next !== 'function') return undefined;
		return filterStream(next());
	});
}