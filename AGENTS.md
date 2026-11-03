## Tests

- Before adding a test, identify the specific behavior, a credible mistake it should catch, and an independently justified expected result.
- Prefer small, fast, reliable tests whose failures identify the broken behavior. Use integration/E2E tests for interactions isolated tests cannot establish.
- Do not reproduce implementation logic in assertions or mocks.
- Protect contracts, not incidental internal structure.
- Distinguish temporary development scaffolding from checks worth maintaining.
- Never delete or weaken a failing test just to make the suite pass.
