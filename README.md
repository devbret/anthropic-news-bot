# Anthropic News Bot

AI-powered news discovery tool which autonomously explores trending topics via `NewsAPI`, uses Anthropic’s Claude model to analyze articles for relevance and surfaces the most significant breaking stories.

## Application Overview

An AI-powered news discovery agent which begins with a root keyword and systematically explores related topics by querying `NewsAPI` for recent articles, then uses Anthropic’s Claude model to analyze batches of results. Using a structured JSON schema, Claude evaluates whether the keyword yields emerging trends, suggests follow-up keywords and identifies super-hot articles from each batch before repeating the process until the predefined daily search quota is exhausted.

Upon completion, the agent generates three timestamped output sets; a (1) comprehensive log detailing every search and decision, (2) deduplicated timeline of super-hot stories and (3) archive of all collected articles. Progress is logged to both the console and `agent_runtime.log`, while output files are saved in the `output` directory for further analysis.

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

11. Exit the virtual environment: `deactivate`

## Other Considerations

This project repo is intended to demonstrate an ability to do the following:

- Discover trending news stories by querying `NewsAPI` and analyzing articles using Anthropic’s Claude AI to identify emerging topics

- Expand searches dynamically by having Claude suggest related keywords, creating a self-propagating discovery system for news discovery

- Curate super hot articles by ranking them based on relevance and urgency from the collected data

- Generate structured logs and timelines, saving JSON outputs with metadata and text files

If you have any questions or would like to collaborate, please reach out either on GitHub or via [my website](https://bretbernhoft.com/).
