Feature: Organizer setup
  An organizer builds an event from reusable templates, prepares its signup form and schedule, then publishes it.

  Background:
    Given the organizer console is open for a seeded authorized guild

  @journey:organizer-setup
  Scenario: Organizer setup - success
    Given a Swedish event template and assignment collection are available
    When I configure signup questions and schedule, preview the event, and publish it
    Then the saved definition and publication result are visible
    And the persisted preview agrees with the configured event definition

  @journey:organizer-setup
  Scenario: Organizer setup - failure
    Given a populated published event
    When I make a structural form change and the server rejects the save
    Then an inline conflict explains that a new form version is required
    And my edits remain available and no saved or published success is shown
    When I make a cosmetic label change and the server rejects the save
    Then an inline error offers Retry and the typed label remains

  @journey:organizer-setup
  Scenario: Organizer setup - empty
    Given the organizer has no event templates or events
    When I open the organizer workspace
    Then a clear first-event or template action is available instead of a blank panel
