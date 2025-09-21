const dotenv = require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fetch = require('node-fetch');

const app = express();

app.use(express.json());
app.use(cors());
app.use(express.static(__dirname + "/public"));

app.use(bodyParser.urlencoded({ extended: true }));
app.set("view engine", "ejs");

/**
 * Build CFBD games URL with the same defaults you’re using now,
 * but with optional week support so /projections can accept it too.
 */
function buildGamesUrl({ year, week, seasonType = 'regular' }) {
  const params = new URLSearchParams();
  params.set('year', year);
  params.set('classification', 'fbs');
  params.set('seasonType', seasonType);
  if (week) params.set('week', week);
  return `https://api.collegefootballdata.com/games?${params.toString()}`;
}

async function fetchGames({ year, week }) {
  const url = buildGamesUrl({ year, week, seasonType: 'regular' });
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${process.env.API_KEY}` }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`CFBD ${response.status}: ${text || 'request failed'}`);
  }
  return response.json();
}
//d
function extractFbsTeams(games) {
  const fbsTeams = new Set();
  games.forEach(game => {
    if (game.homeClassification === 'fbs') fbsTeams.add(game.homeTeam);
    if (game.awayClassification === 'fbs') fbsTeams.add(game.awayTeam);
  });
  return Array.from(fbsTeams);
}
// === Add below your existing helpers in index.js ===
function buildTeamsUrl({ year, classification = 'fbs' }) {
  const params = new URLSearchParams();
  if (year) params.set('year', year);          // keeps you on the selected season
  if (classification) params.set('classification', classification); // limit to FBS
  return `https://api.collegefootballdata.com/teams?${params.toString()}`;
}

async function fetchTeams({ year }) {
  const url = buildTeamsUrl({ year, classification: 'fbs' });
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${process.env.API_KEY}` }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`CFBD ${response.status}: ${text || 'teams request failed'}`);
  }
  return response.json();
}

// Simple normalizer to improve matching between schedule names and CFBD school names
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
}

// Build a map of logos for the exact FBS teams found in games[]
function buildTeamLogosMap({ fbsTeams, teamsMeta }) {
  // index CFBD teams by several keys for best-effort matching
  const bySchool = new Map();
  const byAbbr   = new Map();
  const byAlt    = new Map();

  teamsMeta.forEach(t => {
    const primaryLogo = Array.isArray(t.logos) && t.logos.length ? t.logos[0] : null;
    const entry = {
      school: t.school,
      abbreviation: t.abbreviation,
      alternateNames: Array.isArray(t.alternateNames) ? t.alternateNames : [],
      logo: primaryLogo
    };
    if (t.school) bySchool.set(norm(t.school), entry);
    if (t.abbreviation) byAbbr.set(norm(t.abbreviation), entry);
    entry.alternateNames.forEach(a => byAlt.set(norm(a), entry));
  });

  const teamLogos = {};
  fbsTeams.forEach(name => {
    const k = norm(name);
    let hit =
      bySchool.get(k) ||
      byAlt.get(k) ||
      // Some schedule names look like "Miami (FL)"; try stripping parens
      bySchool.get(norm(name.replace(/\s*\([^)]*\)\s*/g, ''))) ||
      // As a last resort, try abbreviations if the schedule name *is* an abbr
      byAbbr.get(k);

    teamLogos[name] = hit && hit.logo ? hit.logo : null; // keep null if no match
  });

  return teamLogos;
}


// ------------------------- ROUTES -----------------------------


app.get("/teams", async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear();
    const week = req.query.week;

    const games = await fetchGames({ year, week });
    const fbsTeams = extractFbsTeams(games);

    // NEW: fetch teams metadata and build the logo map
    const teamsMeta = await fetchTeams({ year });
    const teamLogos = buildTeamLogosMap({ fbsTeams, teamsMeta });

    res.render("teams", {
      games,
      fbsTeams,
      teamLogos,   // <-- pass to EJS
      req
    });
  } catch (error) {
    console.error('Error fetching CFBD data for /teams:', error);
    res.status(500).send("Failed to fetch data.");
  }
});




// --------------------------------------------------------------

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
