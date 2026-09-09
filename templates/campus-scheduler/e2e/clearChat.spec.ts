import { expect, test } from '@playwright/test';

/**
 * Clearing the assistant conversation.
 *
 * ⚠️ THE STREAM IS STUBBED HERE, DELIBERATELY, AND THAT IS THE OPPOSITE CHOICE TO
 * `assistant.spec.ts`. That file talks to the real Container App because the claim worth guarding
 * there is "a German question reaches a solver". The claim here is about what the COMPONENT does
 * with a response that is still arriving, which needs the timing to be controlled — against the
 * live backend the interesting window is however long Foundry happens to take that afternoon.
 *
 * The second test is the reason this file exists. The first is nearly free once it is set up.
 */

const ANSWER_ONE = 'ANTWORT-EINS-VERWORFEN';
const ANSWER_TWO = 'ANTWORT-ZWEI-BEHALTEN';

/**
 * One NDJSON body in the shape `PlannerChat` parses: a status step, the answer, then done.
 *
 * ⚠️ THE DISCRIMINATOR IS `type`, NOT `kind`. The component stores steps under a local `kind`
 * field, so a stub written from the rendering code produces events it silently ignores — the
 * question appears, the answer never does, and it reads exactly like a broken feature.
 */
function stream(answer: string): string {
  return (
    [
      JSON.stringify({ type: 'status', message: 'denkt nach' }),
      JSON.stringify({ type: 'delta', text: answer }),
      JSON.stringify({ type: 'done' }),
    ].join('\n') + '\n'
  );
}

test('the clear button is not offered until there is something to clear', async ({ page }) => {
  await page.route('**/api/assistant/stream', (route) =>
    route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: stream(ANSWER_TWO) })
  );

  await page.goto('/?scheduler=oth&aoi=oth-regensburg');
  await expect(page.getByTestId('planner-chat')).toBeVisible({ timeout: 60_000 });

  // An empty chat already shows the intro and the suggested questions. A clear button there could
  // only ever do nothing, and a control that cannot act is how a UI teaches people to distrust it.
  await expect(page.getByTestId('planner-clear')).toHaveCount(0);

  await page.getByTestId('planner-input').fill('Wie viele Hörsäle gibt es?');
  await page.getByTestId('planner-send').click();
  await expect(page.getByTestId('planner-chat')).toContainText(ANSWER_TWO, { timeout: 30_000 });
  await expect(page.getByTestId('planner-clear')).toBeVisible();

  await page.getByTestId('planner-clear').click();

  // Gone, and back to the state the panel opens in — not merely visually blank.
  await expect(page.getByTestId('planner-chat')).not.toContainText(ANSWER_TWO);
  await expect(page.getByTestId('planner-clear')).toHaveCount(0);
  await expect(page.getByTestId('planner-chat')).not.toContainText('Wie viele Hörsäle gibt es?');
});

test('an answer discarded mid-flight never lands in the next question', async ({ page }) => {
  // ⚠️ THIS IS THE FAILURE THE FEATURE HAD TO BE BUILT AROUND. `ask` captures
  // `index = history.length` and writes back with `h.map((e, i) => i === index ? … )`. After a
  // clear the next question is index 0 — and a stream still running from the DISCARDED
  // conversation also writes index 0. Without protection its tokens appear underneath a question
  // that never asked them: not a crash, just a confident wrong answer during a demo.
  //
  // ⚠️ THE FIRST VERSION OF THIS TEST PASSED WITH ALL PROTECTION REMOVED, which is the only reason
  // it is written the awkward way it is. It blocked inside the route handler with `await`, and
  // Playwright serialises route handlers per page — so the abandoned answer could not arrive until
  // the handler released, which was before the second answer, which then overwrote it. The leak
  // was real and invisible. The abandoned request is therefore CAPTURED and returned from
  // immediately, leaving it pending without holding the queue, and fulfilled at the end.
  //
  // ⚠️ WHAT THIS PINS IS THE PROPERTY, NOT THE IMPLEMENTATION. `PlannerChat` defends twice — an
  // AbortController and a generation counter — and measurement says EITHER ALONE passes this test;
  // only removing both fails it. So do not read a green run here as evidence that both are
  // working. It is evidence that at least one is.
  let abandoned: { fulfill: (r: { status: number; contentType: string; body: string }) => Promise<void> } | undefined;

  let call = 0;
  await page.route('**/api/assistant/stream', async (route) => {
    call += 1;
    if (call === 1) {
      abandoned = route; // held open, handler returns at once
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body: stream(ANSWER_TWO),
    });
  });

  await page.goto('/?scheduler=oth&aoi=oth-regensburg');
  await expect(page.getByTestId('planner-chat')).toBeVisible({ timeout: 60_000 });

  await page.getByTestId('planner-input').fill('Erste Frage');
  await page.getByTestId('planner-send').click();
  // The exchange exists (so the clear button is offered) while its answer has not arrived.
  await expect(page.getByTestId('planner-clear')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('planner-chat')).not.toContainText(ANSWER_ONE);

  await page.getByTestId('planner-clear').click();
  await expect(page.getByTestId('planner-clear')).toHaveCount(0);

  await page.getByTestId('planner-input').fill('Zweite Frage');
  await page.getByTestId('planner-send').click();
  // The replacement conversation must be fully settled BEFORE the abandoned one is released,
  // otherwise the new answer simply overwrites the old and the leak stays hidden.
  await expect(page.getByTestId('planner-chat')).toContainText(ANSWER_TWO, { timeout: 30_000 });

  await abandoned?.fulfill({
    status: 200,
    contentType: 'application/x-ndjson',
    body: stream(ANSWER_ONE),
  });

  // Give the discarded stream every chance to write before declaring it did not.
  await page.waitForTimeout(1_000);
  await expect(page.getByTestId('planner-chat')).not.toContainText(ANSWER_ONE);
  await expect(page.getByTestId('planner-chat')).not.toContainText('Erste Frage');
  await expect(page.getByTestId('planner-chat')).toContainText(ANSWER_TWO);
});
