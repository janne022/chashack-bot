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

  @journey:organizer-setup
  Scenario: Organizer setup - replacement identity failure
    Given a populated published form with stored question and choice answers
    When I delete and replace a question or choice in its template
    Then the replacement gets a new persisted identity
    And binding the replacement shows an inline structural version conflict
    And the published definition, version and historical answers remain unchanged

  @journey:organizer-setup
  Scenario: Organizer setup - definition validation failure
    When I leave an English question or choice label blank, remove all choices, or leave a matching target incomplete
    Then saving keeps my input and focuses the invalid control with an associated localized error
    And the invalid form template is not persisted
    And duplicate mappings also block embedded event-template save
    And invalid custom questions block event creation before either template or event writes
    When I choose a valid matching target
    Then the mapped form saves successfully

  @journey:organizer-setup
  Scenario: Organizer setup - form editor keyboard lifecycle
    When I open a form template to configure custom questions
    Then the accessibility tree exposes a named modal with focus inside
    And Tab and Shift+Tab wrap between the first field and the last action
    When I press Escape
    Then the editor closes and focus returns to its opener
    And Enter reopens that form editor

  @journey:organizer-setup
  Scenario: Built-in theme library and readable signup import
    Given the guild has not initialized its theme library
    When I open Themes
    Then Default, Halloween and Christmas are visible alongside custom themes
    And deleting a theme does not change forms that copied its appearance
    When I preview a CSV with long Swedish column headers
    Then mapping labels and selects do not overlap at desktop, tablet or mobile widths
    And the desktop import dialog provides a wide review workspace
    When I type an opening brace into an announcement
    Then the selected tag, description and context have readable contrast in both console themes

  @journey:organizer-setup
  Scenario: Edit assignments and rename a matched team
    Given an organizer edits an event with a partially written assignment
    When they insert a team or event variable and switch between tabs
    Then the draft remains and cannot be lost by clicking outside the dialog
    And the saved assignment and distribution action survive reopening
    When the organizer renames a matched team
    Then its name changes without changing the team kind or color

  @journey:organizer-setup
  Scenario: Account, preferences and session changes
    Given the organizer is signed in with Discord
    Then the account menu shows their name without an email address
    And language and theme choices are available on desktop and mobile
    When the selected server changes elsewhere
    Then the old workspace is hidden before selecting a server again
    When the session expires
    Then the organizer can sign in again without losing the open workspace
