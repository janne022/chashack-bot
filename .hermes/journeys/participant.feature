Feature: Participant event and team journey
  Background:
    Given the real served participant interface and a seeded Discord session unless otherwise stated

  @journey:participant
  Scenario: Participant signup - success
    Given a published Swedish event and current guild member
    When I authenticate with Discord and submit all required answers
    Then my registration is shown as complete and a team action is available
    And reopening signup shows the answers saved to my registration

  @journey:participant
  Scenario: Participant signup - failure
    Given a published event and a signed-in participant
    When membership is denied or saving fails after I type answers
    Then I see a membership explanation or inline save error with recovery
    And my typed answers remain available and team allocation is unavailable

  @journey:participant
  Scenario: My hackathons - empty
    Given I have no allowed registrations
    When I open My hackathons
    Then I see event discovery and Discord guidance and no other participant registrations

  @journey:participant
  Scenario: Teams - success
    Given I have a complete eligible registration
    When I create or join a team, invite or respond, or leave
    Then only my permitted team and membership status are shown
    And teammate views do not expose my private signup answers

  @journey:participant
  Scenario: Teams - failure/empty
    Given a full team, stale preview, or no open teams
    When I open the team list or attempt to join or reassign
    Then I see a capacity/conflict error or a useful empty action
    And organizer reassignment is keyboard operable without silently overbooking
