Feature: Organizer setup
  An organizer builds an event from reusable templates, prepares its signup form and schedule, then publishes it.
  # Runnable DOM/AX assertions: DATABASE_URL=<approved _test fixture> node apps/bot/scripts/organizer-browser.mjs
  # Build first with pnpm build. Uses installed Chromium and an isolated PostgreSQL schema.

  Background:
    Given the organizer console is open for a seeded authorized guild

  @journey:organizer-setup
  Scenario: Organizer setup - success
    Given a Swedish event template and assignment collection are available
    When I configure signup questions and schedule, preview the event, and publish it
    Then the saved definition and publication result are visible
    And I can open the published event preview from its workspace
    And the persisted preview agrees with the configured event definition
    And custom question IDs and the selected theme survive editing and publication
    And an incompatible role mapping is removed when changing to multiple choice

  @journey:organizer-setup
  Scenario: Organizer setup - failure
    Given a populated published event
    When I make a structural form change and the server rejects the save
    Then an inline conflict explains that a new form version is required
    And my edits remain available and no saved or published success is shown
    When I make a cosmetic label change and the server rejects the save
    Then an inline error offers Retry and the typed label remains
    When the real server accepts a cosmetic form label change
    Then the label is persisted without changing the published form version

  @journey:organizer-setup
  Scenario: Organizer setup - empty
    Given the organizer has no event templates or events
    When I open the organizer workspace
    Then a clear first-event or template action is available instead of a blank panel
