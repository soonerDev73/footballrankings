const dotenv = require('dotenv').config({ path: require('path').join(__dirname, '.env') });


const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const { client, getGames } = require('cfbd');
const fetch = require('node-fetch');

const app = express();

app.use(express.json());
app.use(cors());
app.use(express.static(__dirname + "/public"));

app.use(bodyParser.urlencoded({ extended: true }));
app.set("view engine", "ejs");

/*mongoose.connect("mongodb://127.0.0.1:27017/playoff2024", {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
    .then(() => console.log("Connected to DB"))
    .catch(console.error);
 */


    app.get("/teams", async (req, res) => {
      try {
        const year = req.query.year || new Date().getFullYear();  // default to current year
    
        const response = await fetch(`https://api.collegefootballdata.com/games?year=${year}&classification=fbs&seasonType=regular`, {
          headers: {
            'Authorization': `Bearer ${process.env.API_KEY}`
          }
        });
        const games = await response.json();
    
        // Extract unique FBS team names
        const fbsTeams = new Set();
        games.forEach(game => {
          if (game.homeClassification === 'fbs') fbsTeams.add(game.homeTeam);
          if (game.awayClassification === 'fbs') fbsTeams.add(game.awayTeam);
        });
    
        res.render("teams", {
          games,
          fbsTeams: Array.from(fbsTeams),
          req // so EJS can read req.query.year
        });
    
      } catch (error) {
        console.error('Error fetching CFBD data:', error);
      }
    });
    




app.listen(3001, () => console.log("Server started on port 3001"));
