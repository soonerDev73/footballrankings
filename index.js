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

// === EXISTING HELPERS FROM YOUR WORKING FILE (KEEPING THEM) ===

// Pull a list of FBS team names from games payload
function extractFbsTeams(games) {
  const fbsTeams = new Set();
  games.forEach(game => {
    if (game.homeClassification === 'fbs') fbsTeams.add(game.homeTeam);
    if (game.awayClassification === 'fbs') fbsTeams.add(game.awayTeam);
  });
  return Array.from(fbsTeams);
}

// Build Teams URL (FBS only)
function buildTeamsUrl({ year, classification = 'fbs' }) {
  const params = new URLSearchParams();
  if (year) params.set('year', year);
  if (classification) params.set('classification', classification);
  return `https://api.collegefootballdata.com/teams?${params.toString()}`;
}

// Fetch Teams (FBS metadata)
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
    if (t.mascot) byAlt.set(norm(`${t.school} ${t.mascot}`), entry);
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

  // Also key by canonical school names so rankings tables can look up by school directly
  teamsMeta.forEach(t => {
    const primaryLogo = Array.isArray(t.logos) && t.logos.length ? t.logos[0] : null;
    if (t.school && !teamLogos[t.school]) teamLogos[t.school] = primaryLogo;
  });

  return teamLogos;
}

// ===================== TEAMS (DO NOT TOUCH) =====================
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

// ===================== NEW: PROJECTIONS =====================
// Keep inputs minimal & non-breaking for your existing projections.ejs
app.get("/projections", async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear();

    // Use same games (raw) as /teams, so client-side code can read either snake_case or camelCase
    const games = await fetchGames({ year });
    const teamsMeta = await fetchTeams({ year });
    const fbsTeams = teamsMeta.map(t => t.school);

    // Build logos usable by either schedule names or canonical school names
    const teamLogos = buildTeamLogosMap({ fbsTeams, teamsMeta });

    // Build simple baseline records + ratings (lightweight server-side seed; client can override)
    const baseRecords = {};
    games.forEach(g => {
      const hp = g.home_points ?? g.homePoints;
      const ap = g.away_points ?? g.awayPoints;
      if (!Number.isFinite(hp) || !Number.isFinite(ap)) return;
      const home = g.home_team || g.homeTeam;
      const away = g.away_team || g.awayTeam;
      baseRecords[home] = baseRecords[home] || { wins: 0, losses: 0 };
      baseRecords[away] = baseRecords[away] || { wins: 0, losses: 0 };
      if (hp > ap) { baseRecords[home].wins++; baseRecords[away].losses++; }
      else { baseRecords[away].wins++; baseRecords[home].losses++; }
    });

    const rating = {};
    fbsTeams.forEach(t => {
      const r = baseRecords[t] || { wins: 0, losses: 0 };
      const gp = r.wins + r.losses;
      rating[t] = gp ? r.wins / Math.max(1, gp) : 0;
    });

    res.render("projections", { fbsTeams: teamsMeta, games, teamLogos, rating, baseRecords });
  } catch (err) {
    console.error("Error in /projections:", err);
    res.render("projections", { fbsTeams: [], games: [], teamLogos: {}, rating: {}, baseRecords: {} });
  }
});

// ===================== NEW: STATS =====================
// FBS only; per-game averages; independent page
app.get("/stats", async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear();
    const [games, teamsMeta, statsRows] = await Promise.all([
      fetchGames({ year }),
      fetchTeams({ year }),
      fetch(`https://api.collegefootballdata.com/stats/season?year=${year}`, {
        headers: { 'Authorization': `Bearer ${process.env.API_KEY}` }
      }).then(r => {
        if (!r.ok) throw new Error(`CFBD ${r.status}: stats request failed`);
        return r.json();
      })
    ]);

    // Completed game counts per-team for per-game averages
    const completedCounts = {};
    games.forEach(g => {
      const hp = g.home_points ?? g.homePoints;
      const ap = g.away_points ?? g.awayPoints;
      if (!Number.isFinite(hp) || !Number.isFinite(ap)) return;
      const home = (g.home_team || g.homeTeam);
      const away = (g.away_team || g.awayTeam);
      const hKey = norm(home), aKey = norm(away);
      completedCounts[hKey] = (completedCounts[hKey] || 0) + 1;
      completedCounts[aKey] = (completedCounts[aKey] || 0) + 1;
    });

    const fbsSet = new Set(teamsMeta.map(t => norm(t.school)));
    const teamLogos = buildTeamLogosMap({ fbsTeams: teamsMeta.map(t=>t.school), teamsMeta });

    // Build per-game averages
    const rowsByTeam = {};
    (Array.isArray(statsRows) ? statsRows : []).forEach(row => {
      const team = row.team || row.school || row.teamName;
      const key = norm(team);
      if (!fbsSet.has(key)) return; // skip non-FBS
      const gp = Math.max(1, completedCounts[key] || 0);
      const acc = (rowsByTeam[team] ||= {});
      (Array.isArray(row.stats) ? row.stats : []).forEach(s => {
        const name = s.statName || s.category || s.name;
        const val = Number(s.value ?? s.stat ?? s.statValue);
        if (!name || !Number.isFinite(val)) return;
        acc[name] = val / gp;
      });
    });

    const allStatNames = Array.from(new Set([].concat(...Object.values(rowsByTeam).map(o=>Object.keys(o))))).sort();
    const rows = Object.keys(rowsByTeam).sort().map(team => ({
      team,
      conference: (teamsMeta.find(t=>t.school===team)?.conference)||'',
      logo: teamLogos[team] || null,
      stats: rowsByTeam[team]
    }));

    res.render("stats", { year, allStatNames, rows });
  } catch (err) {
    console.error("Error in /stats:", err);
    res.status(500).send("Failed to load stats");
  }
});

// ===================== NEW: POLLS =====================
// Strict AP/Coaches only; ?mode=latest (default) or ?mode=all
app.get("/polls", async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear();
    const mode = String(req.query.mode || 'latest').toLowerCase();

    const rankings = await fetch(`https://api.collegefootballdata.com/rankings?year=${year}`, {
      headers: { 'Authorization': `Bearer ${process.env.API_KEY}` }
    }).then(r => {
      if (!r.ok) throw new Error(`CFBD ${r.status}: rankings request failed`);
      return r.json();
    });

    const isAP = (p) => p && p.poll === 'AP Top 25';
    const isCoaches = (p) => p && p.poll === 'Coaches Poll'; // strict to avoid FCS

    const sorted = (Array.isArray(rankings) ? rankings : [])
      .slice()
      .sort((a,b)=> (a.week||0) - (b.week||0));

    const weeks = [];
    let latest = null;
    for (const entry of sorted) {
      const weekNum = Number(entry.week || 0);
      const ap = (entry.polls || []).find(isAP);
      const coaches = (entry.polls || []).find(isCoaches);
      if (!ap && !coaches) break; // stop at first empty trailing week

      const bucket = { week: weekNum, ap: [], coaches: [] };
      if (ap && Array.isArray(ap.ranks)) bucket.ap = ap.ranks.slice().sort((x,y)=>x.rank-y.rank);
      if (coaches && Array.isArray(coaches.ranks)) bucket.coaches = coaches.ranks.slice().sort((x,y)=>x.rank-y.rank);

      latest = bucket;
      weeks.push(bucket);
    }

    const renderWeeks = mode === 'all' ? weeks : (latest ? [latest] : []);
    res.render("polls", { year, weeks: renderWeeks, allWeeks: weeks, mode });
  } catch (err) {
    console.error("Error in /polls:", err);
    res.status(500).send("Failed to load polls");
  }
});

// --------------------------------------------------------------

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
