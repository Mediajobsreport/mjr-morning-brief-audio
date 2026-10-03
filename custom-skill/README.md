# MJR Morning Brief custom Alexa skill

Status: code and interaction model prepared. Amazon skill creation, deployment, simulator/device testing, certification, and publication are still required. This repository does not deploy automatically to Amazon.

The new custom skill reads the latest published `feed.xml` from this repository. Opening it immediately reads the finished edition once, then exits. The existing Flash Briefing and publishing manager continue to work separately. No second daily publish step is needed. This implementation uses Alexa text-to-speech; it does not create an MP3 or provide pause/resume controls.

## Amazon Console setup

1. Create a **new** skill named **MJR Morning Brief**, with **English (US)**, the **Custom** interaction model, and **Alexa-hosted (Node.js)** backend. Use the available starter template. Keep the existing Flash Briefing skill.
2. In **Build > Interaction Model > JSON Editor**, replace the starter model with the full contents of `skill-package/interactionModels/custom/en-US.json`. Save and build the model. The invocation name is `m. j. r. morning brief`, pronounced as individual letters.
3. In **Code**, use **Import Code** to upload `mjr-alexa-custom-skill-code.zip` from the GitHub Actions artifact. The archive has the required root `lambda/` folder. Import `lambda/index.js` and `lambda/package.json`, then deploy. Alternatively replace both starter files with the complete versions in this folder. Remove unused starter helper imports. The Lambda handler is `index.handler`.
4. In **Test**, select **Development**. Test `open m j r morning brief`, `ask m j r morning brief to play the brief`, help, repeat the brief, stop, and an unrelated request. Verify the request/response JSON and listen to the entire edition. Test spoken invocation on an Echo registered to the developer account. Test the desired phrase `play the MJR Morning Brief` too; routing that exact wording is not guaranteed until Amazon testing succeeds.
5. Complete Distribution using `STORE-LISTING.md`, add the existing approved MJR square icon in the sizes requested by the Console, answer the privacy/compliance questions accurately, and run certification validation. Review the final listing and submit for certification. Amazon approval and publication are separate from saving this GitHub code.

The GitHub workflow **Validate MJR Alexa Custom Skill** produces a download named `mjr-alexa-custom-skill` containing the code ZIP, complete interaction model, and setup/listing files. Download and extract that artifact ZIP first, then import the inner code ZIP into Amazon.

## Behavior and limits

- Latest edition is loaded on each launch/play/repeat, so publishing does not require redeploying the skill.
- Intro, story order, segues and outro come directly from the published feed. The skill does not add an extra intro or select/rewrite stories.
- An edition from a previous New York calendar day receives a date announcement. Editions more than seven days old or implausibly in the future fail with a short availability message.
- Briefs longer than 7,800 characters fail gracefully rather than being silently cut. This leaves space below Alexa's 8,000-character speech/card limits.
- Only a fixed public HTTPS feed is fetched, with a four-second deadline, size limit, and redirects disabled. No Amazon identifiers, credentials, or request envelopes are sent to GitHub or logged by the skill.
- No account linking, personal-information permissions, persistent user storage, or paid service dependency is required by this code. Amazon platform logging and hosting terms still apply.
- For a separately hosted Lambda, set `SKILL_ID` and restrict Lambda invocation to Alexa with the skill ID. This code is a Lambda handler, not a public HTTPS server; an HTTPS deployment would also require Alexa signature/timestamp verification.
- Repeat requests replay the latest published edition. Because the brief ends the session, it does not store a listener's prior edition between sessions.

## Checks

From `custom-skill/`, run `npm test`. Run `npm run test:live` separately to validate the current public feed. Automated tests use an October 3, 2026 published edition fixture and a fixed clock. They do not replace Amazon simulator, voice, or device tests.

## Official references

- https://developer.amazon.com/en-US/docs/alexa/hosted-skills/alexa-hosted-skills-create.html
- https://developer.amazon.com/en-US/docs/alexa/custom-skills/choose-the-invocation-name-for-a-custom-skill.html
- https://developer.amazon.com/en-US/docs/alexa/custom-skills/request-and-response-json-reference.html
