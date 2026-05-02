/**
 * Cross-plugin parity fixture — used by cross-plugin-parity.test.ts.
 *
 * One <State>, one <TransitionTo>, all literal props so the extractor's
 * folding rules don't introduce ambiguity. Every emission path (CLI, Vite
 * plugin, Metro plugin) must produce byte-identical IR for this file.
 *
 * NOT intended to be imported as runtime code — it's only here as test input.
 * Don't add this directory to any `tsconfig.json` includes that participate
 * in production builds.
 */

import { State, TransitionTo } from '@qontinui/ui-bridge';

export function ParityFixture() {
  return (
    <>
      <State
        id="parity-login"
        name="Parity Login"
        requiredElements={[{ role: 'button', text: 'Login' }]}
        description="Parity-test fixture state."
      />
      <TransitionTo
        id="parity-login-to-home"
        name="Parity Login → Home"
        fromStates={['parity-login']}
        activateStates={['parity-home']}
        actions={[{ type: 'click', target: { role: 'button', text: 'Login' } }]}
        effect="write"
      />
    </>
  );
}
