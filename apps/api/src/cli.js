import readline from "node:readline";
import { hashPassword, passwordProblem } from "./auth.js";
import { loadConfig } from "./config.js";
import { createStore } from "./store/index.js";

function ask(q, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) { rl._writeToOutput = (s) => { if (s.includes(q)) process.stdout.write(q); }; }
    rl.question(q, (a) => { rl.close(); if (hidden) process.stdout.write("\n"); resolve(a); });
  });
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd !== "create-admin") { console.error("Usage: npm run create-admin -- --email you@example.com [--name 'Your Name'] [--role owner|staff]"); process.exit(1); }
const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const email = (opt("email") || (await ask("Email: "))).trim().toLowerCase();
const name = opt("name") || (await ask("Name: "));
const role = opt("role") || "owner";
// The password is typed at the prompt (or passed via ADMIN_PASSWORD for automated setups). It is never stored in the repo.
const password = process.env.ADMIN_PASSWORD || (await ask("Password (min 10 chars, letters + numbers): ", true));
const problem = passwordProblem(password, email);
if (problem) { console.error(problem); process.exit(1); }
const store = await createStore(loadConfig());
if (await store.admins.findBy("email", email)) { console.error("That email already has an account."); await store.close(); process.exit(1); }
await store.admins.insert({ email, name, role, passwordHash: await hashPassword(password), active: true, tokenVersion: 0, createdAt: new Date().toISOString() });
console.log(`Created ${role} ${email}`);
await store.close();
