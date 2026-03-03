var builder = DistributedApplication.CreateBuilder(args);

builder.AddProject<Projects.Chashack_Bot>("chashack-bot");

builder.Build().Run();
