# Anthropic News Bot

![Screenshot of the Analytics tab after a run.](https://hosting.photobucket.com/bbcfb0d4-be20-44a0-94dc-65bff8947cf2/111dc30d-0b62-497f-b901-48adaa0be702.png)

AI-powered news discovery tool which explores topics via APIs by using Anthropic’s Claude model and surfaces the most significant stories in a dashboard.

## Application Overview

The app begins with a root keyword and queries both the `NewsAPI` and `GNews` APIs concurrently for recent articles. Results are merged and deduplicated by URL. Anthropic's Claude model then analyzes each batch using JSON, determining whether the keyword reveals an emerging trend, suggesting follow-up keywords and flagging important articles. The application also feeds Claude's suggested keywords back into the queue, until the daily search quota is exhausted.

Every run is saved to a timestamped folder inside the `output` directory, which contains a (1) comprehensive log detailing every search and decision, (2) deduplicated timeline of noteworthy stories and (3) archive of all collected articles. A shared `index.json` file catalogs all completed runs for the dashboard.

The dashboard provides Results and Analytics tabs for viewing information about and from any combination of runs. The Analytics tab renders 8 D3 visualizations, including cumulative trends, top sources and a word cloud. It can also request an analysis written by Claude of stories deemed to be critical and relevant.

## Basic Setup Instructions

Below are the set up steps and prerequisite software programs needed for this application to run on a Linux machine.

### Programs Needed

- [Git](https://git-scm.com/downloads)

- [Python](https://www.python.org/downloads/)

### Steps

1. Install the above programs

2. Open a terminal

3. Clone this repository: `git clone git@github.com:devbret/anthropic-news-bot.git`

4. Navigate to the repo's directory: `cd anthropic-news-bot`

5. Create a virtual environment: `python3 -m venv venv`

6. Activate your virtual environment: `source venv/bin/activate`

7. Install the needed dependencies: `pip install -r requirements.txt`

8. Copy and convert the `.env.template` file into a `.env` file: `cp .env.template .env`

9. Add values to the `.env` file

10. Run the script: `python3 app.py`

11. Launch the dashboard: `python3 serve.py`

12. Open the dashboard in a browser: `http://localhost:8000/`

13. When finished, close the dashboard server: `CTRL + C`

14. Exit the virtual environment: `deactivate`

## Other Considerations

This project repo is intended to demonstrate an ability to do the following:

- Discover breaking news by starting from a single root keyword and expanding into related topics suggested by AI

- Query the `NewsAPI` and `GNews` APIs concurrently for every keyword, then merge and deduplicate results

- Use structured JSON to help Claude evaluate each batch of articles for emerging trends and important articles

- Preserve every run as a timestamped archive containing search logs, deduplicated timeline and all collected articles

If you have any questions or would like to collaborate, please reach out either on GitHub or via [my website](https://bretbernhoft.com/).
