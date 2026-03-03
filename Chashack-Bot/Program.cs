using Discord;
using Discord.Interactions;
using Discord.WebSocket;

var builder = Host.CreateApplicationBuilder(args);

// Discord client configuration
builder.Services.AddSingleton(provider =>
{
    var config = new DiscordSocketConfig
    {
        GatewayIntents = GatewayIntents.AllUnprivileged | GatewayIntents.MessageContent,
        AlwaysDownloadUsers = true,
        LogLevel = LogSeverity.Info
    };
    return new DiscordSocketClient(config);
});

// Modals
builder.Services.AddSingleton(provider =>
{
    var client = provider.GetRequiredService<DiscordSocketClient>();

    var config = new InteractionServiceConfig
    {
        DefaultRunMode = RunMode.Async,
        LogLevel = LogSeverity.Info
    };

    return new InteractionService(client, config);
});

var host = builder.Build();
host.Run();
