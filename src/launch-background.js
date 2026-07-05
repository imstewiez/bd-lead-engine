import { BACKGROUND_TASKS, ensureBackgroundTasks } from "./process-manager.js";

const results = await ensureBackgroundTasks(Object.keys(BACKGROUND_TASKS));
for (const task of results) {
  console.log(`${task.name}=${task.pid} (${task.status})`);
}
