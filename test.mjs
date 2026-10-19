/**
 * 自测：纯函数 + 流式剥离器 + 端到端分片过滤。
 * 样本取自本机会话日志里实际观察到的泄漏文本。
 * 运行：node test.mjs
 */
import assert from 'node:assert/strict';
import { stripLeadingThinking, filterStream } from './index.js';

let passed = 0;
const cases = [];

function check(label, actual, expected) {
	assert.equal(actual, expected, label);
	cases.push(label);
	passed += 1;
}

// ---- 纯函数 ----
check('整个块都是思考', stripLeadingThinking('<thinking>Let me read the spec doc.</thinking>'), '');
check('思考后面接正文', stripLeadingThinking('<thinking>plan</thinking>已继续 fav-detail-closeout。'), '已继续 fav-detail-closeout。');
check('前导空白', stripLeadingThinking('\n  <thinking>x</thinking>正文'), '正文');
check('未闭合', stripLeadingThinking('<thinking>never closed'), '');
check('正文无标签', stripLeadingThinking('普通正文'), '普通正文');
check('中间出现标签不动', stripLeadingThinking('正文里的 <thinking> 是讨论'), '正文里的 <thinking> 是讨论');
check('空串', stripLeadingThinking(''), '');
check('非字符串', stripLeadingThinking(undefined), undefined);

// ---- 流式：标签被切片 ----
async function run(chunks) {
	const out = [];
	for await (const chunk of filterStream((async function* () { for (const c of chunks) yield c; })())) out.push(chunk);
	return out;
}

const textOf = (chunks) => chunks.filter((c) => c.type === 'text-delta').map((c) => c.text).join('');
const blockOf = (chunks) => chunks.filter((c) => c.type === 'block-end').map((c) => c.block.text).join('|');

{
	const out = await run([
		{ type: 'block-start', index: 0, blockType: 'text' },
		{ type: 'text-delta', index: 0, text: '<thin' },
		{ type: 'text-delta', index: 0, text: 'king>think' },
		{ type: 'text-delta', index: 0, text: 'ing</thinking>真' },
		{ type: 'text-delta', index: 0, text: '正文' },
		{ type: 'block-end', index: 0, block: { type: 'text', text: '<thinking>thinking</thinking>真正文' } },
	]);
	check('切片标签：流式输出', textOf(out), '真正文');
	check('切片标签：最终块', blockOf(out), '真正文');
}

{
	const out = await run([
		{ type: 'text-delta', index: 0, text: '普通' },
		{ type: 'text-delta', index: 0, text: '<thin' },
		{ type: 'text-delta', index: 0, text: 'x' },
		{ type: 'block-end', index: 0, block: { type: 'text', text: '普通<thinx' } },
	]);
	check('伪标签原样放行', textOf(out), '普通<thinx');
	check('伪标签最终块原样', blockOf(out), '普通<thinx');
}

{
	const out = await run([
		{ type: 'reasoning-delta', index: 0, text: '<thinking>这是思考通道' },
		{ type: 'text-delta', index: 1, text: '正文' },
	]);
	check('思考通道不动', out[0].text, '<thinking>这是思考通道');
	check('正文通道照常', out[1].text, '正文');
}

{
	const out = await run([
		{ type: 'tool-call-delta', index: 0, id: 'x', argumentsDelta: '{"a":"<thinking>"}' },
		{ type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
	]);
	check('工具与用量分片透传', out.length, 2);
}

console.log(`全部通过：${passed} 项`);
for (const c of cases) console.log('  ✓ ' + c);