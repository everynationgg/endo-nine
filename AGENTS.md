# AGENTS.md — AI Agent Development & Worldbuilding Guidelines

## Narrative Canon & Source of Truth

The official narrative canon, worldbuilding, chronology, and thematic framework of **Endo Nine** (the sequel to *Errant Night*) are permanently documented in:

👉 [`docs/LORE_CANON.md`](./docs/LORE_CANON.md)

---

## Mandatory Instructions for AI Agents

Whenever a development task involves:
- **Environments & Biomes**
- **Characters & Hero Design**
- **Enemies & Boss Mechanics**
- **Stage Progression & Map Layouts**
- **Visual & Audio Aesthetic Direction**
- **Dialogue, Lore Drops, or Text Strings**
- **World Events, Overseer Artifacts, & Structures**

You **MUST** consult [`docs/LORE_CANON.md`](./docs/LORE_CANON.md) and observe the following rules:

### 1. Prototype Context: Main Campaign Stage 1 (The Thawing Crash-Site Crater)
* **The current playable build represents MAIN CAMPAIGN STAGE 1 (the actual beginning of Endo Nine).**
* Every run begins at the **crash-site crater** alongside the large wrecked spacecraft after the Alien crashed the ship near the first Overseer artifact and began thawing the planet.
* The environment reflects a **freshly thawing alien ecosystem** (blended thawed dark soil, frost/snow patches, exposed crater rock, and reawakening alien biological flora).
* The **Dimensional Loop** remains canonical as the later alternate campaign route triggered at Stage 8.

### 2. The Core Narrative Revelation
* The central conflict and moral revelation of the game is that **the Overseers misjudged the alien species**.
* What the Overseers mistook for military expansion was actually the species' natural, rapid biological reproduction and environmental cultivation.
* Rapid growth does **not** equal hostile intent.

### 3. Alien Architecture & Enemies
* Alien structures are organic, grown, biological, or symbiotic with the ecosystem—not human-style industrial factories or metal cities.
* Hostile gameplay behaviors of wild or territorial organisms do not mean the alien civilization is inherently evil or warmongering.

### 4. Preservation of Established Endings
* **Bad Ending:** Alien defeats the Overseer and humans, steals Overseer intelligence, and builds a force to threaten the Overseers' homeworld.
* **Normal Ending:** The Alien is defeated and the planet is permanently refrozen; humans survive, but the alien civilization remains unjustly suppressed.
* **Good Ending:** The crew uncovers the truth via the dimensional loop, spares the Alien, and reconciles the Overseer and the alien civilization.
* Do **not** invent or substitute alternate endings without explicit instruction.

### 5. Architectural & Database Scope
* Do **not** insert this lore into Supabase, PostgreSQL, or application database tables. This is development documentation, not runtime application data.
* Do not rewrite or alter canonical facts established in `docs/LORE_CANON.md`.

