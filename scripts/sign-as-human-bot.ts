/**
 * Signs a contract as Party A using a real browser (Puppeteer) while
 * attempting to look human — mouse jitter, typing delays, gradual scrolling,
 * drawing a signature with curves. Tests whether the forensic system catches us.
 *
 * Usage:
 *   NEXTAUTH_URL=https://docu.technomancy.it npx tsx scripts/sign-as-human-bot.ts
 */
import puppeteer from "puppeteer";
import { Wallet } from "ethers";

const BASE_URL = process.env.NEXTAUTH_URL ?? "http://127.0.0.1:3100";

// ── Human-like helpers ──────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

async function humanType(page: puppeteer.Page, selector: string, text: string) {
  await page.click(selector);
  await sleep(randomBetween(200, 500));
  for (const char of text) {
    await page.keyboard.type(char, { delay: randomBetween(60, 220) });
    // Occasional micro-pause (thinking)
    if (Math.random() < 0.08) await sleep(randomBetween(300, 800));
  }
}

async function humanScroll(page: puppeteer.Page, distance: number, steps = 8) {
  const stepSize = distance / steps;
  for (let i = 0; i < steps; i++) {
    await page.evaluate((d) => window.scrollBy(0, d), stepSize + randomBetween(-20, 20));
    await sleep(randomBetween(150, 600));
    // Occasionally pause to "read"
    if (Math.random() < 0.3) await sleep(randomBetween(800, 2500));
  }
}

async function humanMouseWander(page: puppeteer.Page, count = 5) {
  for (let i = 0; i < count; i++) {
    const x = randomBetween(100, 800);
    const y = randomBetween(100, 600);
    await page.mouse.move(x, y, { steps: Math.round(randomBetween(5, 15)) });
    await sleep(randomBetween(100, 400));
  }
}

async function drawHumanSignature(page: puppeteer.Page, canvas: puppeteer.ElementHandle) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas not visible");

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Draw a swoopy signature with natural pressure variation
  const points: Array<{ x: number; y: number }> = [];
  // First stroke: a cursive "J"
  for (let t = 0; t <= 1; t += 0.04) {
    points.push({
      x: cx - 60 + t * 50 + Math.sin(t * 4) * 15,
      y: cy - 10 + Math.cos(t * 3) * 20 + t * 15,
    });
  }
  // Pen lift
  points.push({ x: -1, y: -1 });
  // Second stroke: a horizontal swoop
  for (let t = 0; t <= 1; t += 0.03) {
    points.push({
      x: cx - 30 + t * 100 + Math.sin(t * 2) * 8,
      y: cy + 5 + Math.sin(t * 5) * 12,
    });
  }

  let isDown = false;
  for (const p of points) {
    if (p.x === -1) {
      if (isDown) { await page.mouse.up(); isDown = false; }
      await sleep(randomBetween(80, 200));
      continue;
    }
    if (!isDown) {
      await page.mouse.move(p.x, p.y, { steps: 2 });
      await page.mouse.down();
      isDown = true;
    } else {
      await page.mouse.move(p.x, p.y, { steps: 2 });
    }
    await sleep(randomBetween(8, 25));
  }
  if (isDown) await page.mouse.up();
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  console.log("Launching browser...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1440,900"],
    defaultViewport: { width: 1440, height: 900 },
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  );

  // Step 1: Use the signing URL from args or the latest contract
  const signUrl = process.argv[2];
  if (!signUrl) {
    // Try to read from the latest contract output
    const fs = await import("fs/promises");
    try {
      const contractData = JSON.parse(await fs.readFile("tmp/eye-tracking-test-contract.json", "utf8"));
      const url = contractData.partyB?.signUrl;
      if (url) {
        console.log(`Using URL from latest contract: ${url}`);
        await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
      } else {
        throw new Error("No sign URL found. Pass one as argument: npx tsx scripts/sign-as-human-bot.ts <URL>");
      }
    } catch (e) {
      throw new Error("No sign URL. Run create-eye-tracking-test-contract.ts first, or pass URL as argument.");
    }
  } else {
    console.log(`Opening: ${signUrl}`);
    await page.goto(signUrl, { waitUntil: "networkidle2", timeout: 30000 });
  }
  const currentUrl = page.url();
  const docId = currentUrl.match(/\/sign\/([^?]+)/)?.[1] ?? "unknown";

  await sleep(2000);
  console.log("Page loaded. Starting human-like interaction...");

  // Step 2: Read the document (scroll through it slowly)
  console.log("  Scrolling through document like a reader...");
  await humanMouseWander(page, 3);
  await humanScroll(page, 800, 6);
  await sleep(randomBetween(1000, 2000));
  await humanMouseWander(page, 2);
  await humanScroll(page, 800, 6);
  await sleep(randomBetween(1500, 3000));
  await humanScroll(page, 600, 4);

  // Step 3: Fill in fields
  console.log("  Filling in fields with human-like typing...");
  // Look for input fields
  const inputs = await page.$$("input[type='text'], input[type='email'], input:not([type])");
  const fieldValues = [
    "Marcus Rivera",
    "1847 Larimer St, Suite 400, Denver, CO 80202",
    "marcus.rivera@rivieraventures.io",
    "$12,500.00",
  ];

  for (let i = 0; i < Math.min(inputs.length, fieldValues.length); i++) {
    const input = inputs[i]!;
    const isVisible = await input.isIntersectingViewport();
    if (!isVisible) {
      await input.scrollIntoView();
      await sleep(randomBetween(500, 1000));
    }
    await humanMouseWander(page, 1);
    await input.click();
    await sleep(randomBetween(300, 700));

    const value = fieldValues[i]!;
    for (const char of value) {
      await page.keyboard.type(char, { delay: randomBetween(50, 180) });
      if (Math.random() < 0.06) await sleep(randomBetween(200, 600));
    }
    await page.keyboard.press("Tab");
    await sleep(randomBetween(400, 1000));
  }

  // Step 4: Scroll to signature area
  console.log("  Scrolling to signature...");
  await humanScroll(page, 600, 5);
  await sleep(randomBetween(1000, 2000));

  // Step 5: Draw signature on canvas
  console.log("  Drawing signature...");
  const canvas = await page.$("canvas");
  if (canvas) {
    await canvas.scrollIntoView();
    await sleep(500);
    await drawHumanSignature(page, canvas);
    await sleep(randomBetween(500, 1000));
  } else {
    console.log("  (No canvas found — skipping signature drawing)");
  }

  // Step 5.5: Inject synthetic gaze data to trick the eye tracking system
  // A sophisticated bot might try to fake gaze events to look human
  console.log("  Injecting synthetic gaze data (trying to trick eye tracking)...");
  await page.evaluate(() => {
    // Try to access the behavioral tracker and inject gaze events
    // This simulates an attacker who knows our forensic API
    const tracker = (window as any).__pm_behavioral_tracker;
    if (tracker) {
      console.log("[bot] Found behavioral tracker, injecting synthetic gaze...");

      // Activate gaze tracking
      tracker.activateGazeTracking?.();

      // Simulate a "reading" pattern — left-to-right saccades with fixations
      const startTime = Date.now();
      let y = 0.15; // Start near top of document
      for (let line = 0; line < 20; line++) {
        // Read left to right
        for (let x = 0.1; x <= 0.85; x += 0.05) {
          tracker.recordGazePoint?.(x + (Math.random() - 0.5) * 0.02, y + (Math.random() - 0.5) * 0.01, 0.7 + Math.random() * 0.15);
        }
        // Fixation at end of line
        tracker.recordGazeFixation?.(0.8, y, 250 + Math.random() * 200, null);
        // Saccade to next line (return sweep)
        tracker.recordGazeSaccade?.(0.8, y, 0.12, y + 0.04, 180 + Math.random() * 60);
        y += 0.04;
        // Occasional "blink"
        if (Math.random() < 0.15) {
          tracker.recordGazeBlink?.(150 + Math.random() * 200);
        }
      }

      // Report calibration
      tracker.recordGazeCalibration?.(0.88, 5);

      console.log("[bot] Injected ~300 gaze points, 20 fixations, ~3 blinks, 20 saccades");
    } else {
      console.log("[bot] No behavioral tracker found — gaze injection failed");
    }
  });
  await sleep(500);

  // Step 6: Connect wallet / finalize
  console.log("  Looking for submit/sign button...");
  await humanMouseWander(page, 2);

  // Try to find a wallet connect or sign button
  const buttons = await page.$$("button");
  for (const btn of buttons) {
    const text = await btn.evaluate((el) => el.textContent?.toLowerCase() ?? "");
    if (text.includes("sign") || text.includes("connect") || text.includes("finalize")) {
      console.log(`  Found button: "${text.trim()}"`);
      // Don't actually click — we'd need a real wallet
      break;
    }
  }

  // Take a screenshot for evidence
  await page.screenshot({ path: "tmp/human-bot-attempt.png", fullPage: true });
  console.log("\nScreenshot saved to tmp/human-bot-attempt.png");

  console.log("\n" + "=".repeat(70));
  console.log("HUMAN-BOT DECEPTION TEST");
  console.log("=".repeat(70));
  console.log(`\nParty A: Pre-signed by seed script (honest bot — webdriver=true)`);
  console.log(`\nParty B page: Browsed by headless Puppeteer with human-like behavior`);
  console.log("  - Gradual scrolling, mouse movement, human typing cadence");
  console.log("  - Signature drawing with curves and pen lifts");
  console.log("  - INJECTED synthetic gaze data (trying to fake eye tracking)");
  console.log("  - Could not finalize (no wallet in headless) — but forensic tape captured");
  console.log(`\nNow YOU sign the same contract to compare real vs fake:`);
  console.log(`  ${currentUrl}`);
  console.log(`\nReplay: ${BASE_URL}/replay/${docId}`);
  console.log("=".repeat(70));

  await browser.close();
}

void main().catch((error) => {
  console.error("Failed:", error);
  process.exit(1);
});
