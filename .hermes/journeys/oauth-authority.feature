Feature: OAuth-only organizer sessions and fresh guild authority
  Organizer identity comes only from Discord OAuth, and a login-time permission
  snapshot never substitutes for current guild membership.

  Scenario: OAuth authority - successful sign-in
    Given an organizer is currently an owner, Administrator, or delegated organizer in multiple bot-installed guilds
    When Discord OAuth completes successfully
    Then the organizer sees the current guild and can open the accessible guild switcher

  Scenario: OAuth authority - stale permissions
    Given an organizer session whose guild role was removed after sign-in
    When the organizer saves a change
    Then the request is refused with an access-refused recovery message

  Scenario: OAuth authority - no manageable guilds
    Given the signed-in Discord user manages no guild where the bot is installed
    When the OAuth callback returns
    Then an accessible alert explains that an organizer can grant access or install the bot
    And the Discord sign-in action remains available
