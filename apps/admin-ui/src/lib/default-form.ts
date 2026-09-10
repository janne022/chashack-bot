import type { FormConfig } from "@/types"

export const DEFAULT_FORM: FormConfig = {
  version: 1,
  title: "Hackathon Signup",
  description: "Tell us how you work and we will build a team around you.",
  teamSize: 4,
  experiences: [
    { id: "first_timer", label: "First hackathon" },
    { id: "some_experience", label: "1–3 hackathons" },
    { id: "veteran", label: "Veteran (4+)" },
  ],
  roleTracks: [
    { id: "frontend", label: "Frontend" },
    { id: "backend", label: "Backend" },
    { id: "fullstack", label: "Fullstack" },
    { id: "design", label: "Design" },
    { id: "devops", label: "DevOps" },
    { id: "flex", label: "Flex / wherever needed" },
  ],
  skills: [
    { id: "frontend_react", label: "Frontend — React", group: "frontend" },
    { id: "frontend_vue", label: "Frontend — Vue", group: "frontend" },
    { id: "frontend_mobile", label: "Frontend — Mobile", group: "frontend" },
    { id: "ui_design", label: "UI/UX Design", group: "" },
    { id: "devops", label: "DevOps / Infra", group: "" },
    { id: "data_ml", label: "Data / ML", group: "" },
    { id: "ai_integrations", label: "AI integrations", group: "" },
    { id: "pm_pitch", label: "PM / Pitching", group: "" },
    { id: "backend_node", label: "Backend — Node/TypeScript", group: "backend" },
    { id: "backend_python", label: "Backend — Python", group: "backend" },
    { id: "backend_csharp", label: "Backend — C#/.NET", group: "backend" },
    { id: "backend_go", label: "Backend — Go", group: "backend" },
    { id: "backend_java", label: "Backend — Java/Kotlin", group: "backend" },
  ],
  teamPrefs: [
    { id: "create_team", label: "Create my own team and invite people" },
    { id: "join_team", label: "Ask to join an existing team" },
    { id: "random_team", label: "Get matched into a random team" },
  ],
}
