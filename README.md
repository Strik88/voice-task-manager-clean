# Voice Task Manager

A simple web application that lets you create tasks using your voice. The app transcribes your speech using OpenAI's Whisper API and then extracts actionable tasks using GPT.

## Features

- Voice-to-text transcription
- Automatic task extraction with priorities, due dates, and categories
- Secure API key storage (stored only in your browser's local storage)
- Copy tasks to clipboard for use in other applications
- Works on both desktop and mobile devices

## How to Use

### Step 1: Set Up Your OpenAI API Key

1. Sign up for an OpenAI account at [https://platform.openai.com/signup](https://platform.openai.com/signup)
2. Generate an API key at [https://platform.openai.com/api-keys](https://platform.openai.com/api-keys)
3. Keep this key confidential - you'll need it to use the app

### Step 2: Use the App

1. Enter your OpenAI API key when prompted
2. Click "Start Recording" and speak your tasks clearly
3. After you finish speaking, click "Stop Recording"
4. The app will transcribe your speech and extract tasks
5. Use the "Copy All Tasks" button to copy tasks to clipboard for use in other applications

### Examples of What to Say

- "Call John about the project proposal by Friday, it's very important"
- "Buy groceries today and clean the kitchen tomorrow"
- "Finish writing the report for work, high priority, due next Monday"
- "Schedule a doctor's appointment sometime next week"

## Privacy Notice

- Your API key is stored only in your browser's local storage and is never sent to our servers
- Audio processing is done using OpenAI's APIs directly from your browser
- No voice data is stored on our servers

## Running Locally

If you prefer to run this app locally instead of using the hosted version:

1. Clone this repository
2. Open the `index.html` file in your web browser
3. Enter your OpenAI API key when prompted

## Deploying to GitHub Pages

To deploy your own version of this app on GitHub Pages:

1. Fork this repository
2. Go to your repository settings
3. Navigate to "Pages"
4. Select "main" as the source branch
5. Click "Save"
6. Your site will be published at `https://yourusername.github.io/repository-name/`

## Future Enhancements

- Integration with Notion (coming soon)
- Dark mode support
- Multiple task lists
- Export options to different formats

## License

MIT 