import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const XLSX = require("../frontend/node_modules/xlsx");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const companies = [
  ["Monzo", "https://monzo.com", "Digital bank"],
  ["Starling Bank", "https://www.starlingbank.com", "Digital bank"],
  ["Octopus Energy", "https://octopus.energy", "Energy supplier"],
  ["Deliveroo", "https://deliveroo.co.uk", "Food delivery"],
  ["Revolut", "https://www.revolut.com", "Fintech"],
  ["Gousto", "https://www.gousto.co.uk", "Meal kits"],
  ["Trainline", "https://www.thetrainline.com", "Rail tickets"],
  ["Rightmove", "https://www.rightmove.co.uk", "Property portal"],
  ["Zoopla", "https://www.zoopla.co.uk", "Property portal"],
  ["Auto Trader", "https://www.autotrader.co.uk", "Car marketplace"],
  ["Gymshark", "https://www.gymshark.com", "Athleisure"],
  ["BrewDog", "https://www.brewdog.com", "Brewery"],
  ["Innocent Drinks", "https://www.innocentdrinks.co.uk", "Drinks"],
  ["Huel", "https://huel.com", "Nutrition"],
  ["Moonpig", "https://www.moonpig.com", "Cards & gifts"],
  ["AO", "https://ao.com", "Electrical retail"],
  ["Currys", "https://www.currys.co.uk", "Electrical retail"],
  ["Screwfix", "https://www.screwfix.com", "Trade supplies"],
  ["Toolstation", "https://www.toolstation.com", "Trade supplies"],
  ["Howdens", "https://www.howdens.com", "Kitchens"],
  ["Travis Perkins", "https://www.travisperkins.co.uk", "Builders merchant"],
  ["Wickes", "https://www.wickes.co.uk", "DIY"],
  ["Ocado", "https://www.ocado.com", "Grocery"],
  ["Abel & Cole", "https://www.abelandcole.co.uk", "Organic grocery"],
  ["Riverford", "https://www.riverford.co.uk", "Veg boxes"],
  ["HelloFresh UK", "https://www.hellofresh.co.uk", "Meal kits"],
  ["Mindful Chef", "https://www.mindfulchef.com", "Meal kits"],
  ["Cinch", "https://www.cinch.co.uk", "Used cars"],
  ["Motorway", "https://motorway.co.uk", "Car selling"],
  ["Compare the Market", "https://www.comparethemarket.com", "Price comparison"],
  ["MoneySuperMarket", "https://www.moneysupermarket.com", "Price comparison"],
  ["Confused.com", "https://www.confused.com", "Insurance comparison"],
  ["GoCardless", "https://gocardless.com", "Payments"],
  ["Checkout.com", "https://www.checkout.com", "Payments"],
  ["Wise", "https://wise.com", "Money transfer"],
  ["Tide", "https://www.tide.co", "Business banking"],
  ["FreeAgent", "https://www.freeagent.com", "Accounting"],
  ["Xero", "https://www.xero.com", "Accounting"],
  ["Sage", "https://www.sage.com", "Accounting"],
  ["Capital on Tap", "https://www.capitalontap.com", "Business credit"],
  ["Funding Circle", "https://www.fundingcircle.com", "SME lending"],
  ["Iwoca", "https://www.iwoca.co.uk", "SME lending"],
  ["OakNorth", "https://oaknorth.co.uk", "Business bank"],
  ["Darktrace", "https://www.darktrace.com", "Cybersecurity"],
  ["Thought Machine", "https://www.thoughtmachine.net", "Core banking"],
  ["Faculty", "https://faculty.ai", "Applied AI"],
  ["Evri", "https://www.evri.com", "Parcels"],
  ["Yodel", "https://www.yodel.co.uk", "Parcels"],
  ["DPD UK", "https://www.dpd.co.uk", "Parcels"],
  ["Palletways", "https://www.palletways.com", "Pallet network"],
];

if (companies.length !== 50) {
  throw new Error(`Need 50 companies, got ${companies.length}`);
}

const header = ["Company", "Phone", "Email", "Website", "Contact", "Channel", "Notes"];
const rows = companies.map(([name, website, sector], i) => [
  name,
  "",
  "",
  website,
  "",
  "voice",
  `Incomplete test row ${i + 1} — ${sector}. Leave phone/email/contact blank so AI Chat can look them up.`,
]);

const wb = XLSX.utils.book_new();
const contactAoA = [header, ...rows];
const contacts = XLSX.utils.aoa_to_sheet(contactAoA);
contacts["!cols"] = [
  { wch: 24 },
  { wch: 16 },
  { wch: 28 },
  { wch: 36 },
  { wch: 22 },
  { wch: 12 },
  { wch: 72 },
];
XLSX.utils.book_append_sheet(wb, contacts, "Contacts");

const howToAoA = [
  ["AIVHub Voice — incomplete list test file"],
  [""],
  ["What this file is"],
  ["50 real UK companies with websites filled in, and Phone / Email / Contact left blank."],
  ["Upload it into Voice → New Outreach to test Find missing details."],
  [""],
  ["Counts (formulas)"],
  ["Companies", 0],
  ["Missing phones", 0],
  ["Missing emails", 0],
  ["Missing contacts", 0],
  [""],
  ["How to use in the app"],
  ["1. Open AIVHub (http://localhost:5173) and log in."],
  ["2. Open the AI Voice Assistant plugin."],
  ["3. Click New Outreach."],
  ["4. Choose Provide Contact List / Setup → Upload file."],
  ["5. Select this workbook. Keep column mapping: Company, Phone, Email, Website, Contact, Channel."],
  ["6. Leave incomplete rows ticked (missing phone is allowed). Click Continue & find missing details in AI Chat."],
  ["7. Wait. Lookup hits each company website plus public search for LinkedIn / socials / Reddit mentions / emails."],
  ["8. Read each proposed card. Accept writes onto the list. Skip leaves the row unchanged."],
  ["9. Confirm & start mission stays locked until at least one row has a phone (voice) or email (email channel)."],
  [""],
  ["What the lookup will and will not do"],
  ["Will: public website pages, footer/contact emails, tel: links, LinkedIn/X/Facebook/Instagram/YouTube/Reddit URLs found on the site or in public search."],
  ["Will not: log into Gmail, scrape a private inbox, log into LinkedIn, invent phone numbers, or send WhatsApp/SMS."],
  ["Gmail addresses only appear if a company published them on a public page."],
  ["50 rows can take 1–3 minutes. Stay on the AI Chat tab until cards appear."],
];
const howTo = XLSX.utils.aoa_to_sheet(howToAoA);
howTo["B8"] = { t: "n", f: "COUNTA(Contacts!A2:A51)" };
howTo["B9"] = { t: "n", f: "COUNTBLANK(Contacts!B2:B51)" };
howTo["B10"] = { t: "n", f: "COUNTBLANK(Contacts!C2:C51)" };
howTo["B11"] = { t: "n", f: "COUNTBLANK(Contacts!E2:E51)" };
howTo["!cols"] = [{ wch: 28 }, { wch: 100 }];
XLSX.utils.book_append_sheet(wb, howTo, "How to use");

const out = path.join(__dirname, "AIVHub_test_50_companies.xlsx");
XLSX.writeFile(wb, out);
console.log("wrote", out, "rows", rows.length);
if (!fs.existsSync(out)) throw new Error("missing output");
