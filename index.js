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

// ------------------------- ROUTES -----------------------------


app.get("/teams", async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear(); // default current year
    const week = req.query.week; // optional

    const games = await fetchGames({ year, week });
    const fbsTeams = extractFbsTeams(games);

    res.render("teams", {
      games,
      fbsTeams,
      req // so EJS can read req.query.year / week
    });
  } catch (error) {
    console.error('Error fetching CFBD data for /teams:', error);
    res.status(500).send("Failed to fetch data.");
  }
});




// --------------------------------------------------------------

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
