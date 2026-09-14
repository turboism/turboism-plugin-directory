import test from 'node:test';
import assert from 'node:assert/strict';
import { qqMarkup, qqStaticScript } from './qq.mjs';
for (const locale of ['en', 'zh', 'ja', 'ko']) {
  test(`${locale}: the QQ icon only opens the panel and the separate action retains the native link`, () => {
    const markup = qqMarkup(locale);
    const trigger = markup.match(/<[^>]+data-qq-trigger[^>]*>/)?.[0] ?? '';
    assert.match(trigger, /^<button\b/);
    assert.match(trigger, /type="button"/);
    assert.doesNotMatch(trigger, /\bhref=/);
    assert.match(markup, /<a[^>]+data-qq-launch[^>]+href="mqqapi:\/\//);
    assert.match(markup, /data-qq-copy/);
    assert.match(markup, /aria-live="polite"/);
  });
}
test('the static SDK script contains no automatic launch message or trigger URI', () => {
  assert.doesNotMatch(qqStaticScript(), /Opening QQ was requested|已尝试打开 QQ|QQ の起動を要求しました|QQ 실행을 요청했습니다|trigger\.href\s*=|t\.waiting/);
  new Function(qqStaticScript());
});
