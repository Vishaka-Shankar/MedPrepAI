import { QuizData, QuizQuestion } from '../types/quiz';

/**
 * MOCK quiz (the page shows a "Sample data" label). The questions are real Cell transport
 * facts; the page numbers and videos are placeholders. Replaced by the quiz API in M5.
 */

/** Placeholder video link: a YouTube search for the title (real videos come from the YouTube API in M5). */
const video = (title: string, duration: string) => ({
  title,
  channel: 'Sample channel',
  duration,
  url: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} MDCAT biology`)}`,
});

const questions: QuizQuestion[] = [
  {
    id: 'q1',
    stem: 'Which molecule forms the bilayer that makes up most of the plasma membrane?',
    options: ['Cellulose', 'Phospholipid', 'Glycogen', 'Keratin'],
    answerKey: 1,
    explanation:
      'The plasma membrane is a phospholipid bilayer: hydrophilic heads face the water on both sides and hydrophobic tails face inwards.',
    source: 'Biology XI · page 84',
    video: video('The fluid mosaic model', '6:45'),
  },
  {
    id: 'q2',
    stem: 'Which process uses energy from ATP to move substances against a concentration gradient?',
    options: ['Simple diffusion', 'Osmosis', 'Active transport', 'Facilitated diffusion'],
    answerKey: 2,
    explanation: 'Active transport needs carrier proteins and energy from ATP because it moves substances from low to high concentration.',
    source: 'Biology XI · page 86',
    video: video('Active transport in 5 minutes', '5:10'),
  },
  {
    id: 'q3',
    stem: 'Which process moves water across a semi-permeable membrane from higher to lower water potential?',
    options: ['Diffusion', 'Active transport', 'Osmosis', 'Facilitated diffusion'],
    answerKey: 2,
    explanation:
      'Osmosis is passive movement of water across a membrane. Active transport needs energy to move substances against a gradient.',
    source: 'Biology XI · page 87',
    video: video('Osmosis explained', '8:20'),
  },
  {
    id: 'q4',
    stem: 'For each ATP used, the sodium-potassium pump moves:',
    options: ['3 Na+ out and 2 K+ in', '2 Na+ out and 3 K+ in', '3 Na+ in and 2 K+ out', '1 Na+ out and 1 K+ in'],
    answerKey: 0,
    explanation: 'The pump moves three sodium ions out of the cell and two potassium ions in for every ATP it uses.',
    source: 'Biology XI · page 88',
    video: video('The sodium-potassium pump', '7:05'),
  },
  {
    id: 'q5',
    stem: 'Facilitated diffusion differs from simple diffusion because it:',
    options: ['Uses ATP', 'Needs carrier or channel proteins', 'Moves against the gradient', 'Only moves water'],
    answerKey: 1,
    explanation:
      'Facilitated diffusion is still passive (no ATP, down the gradient), but molecules such as glucose need carrier or channel proteins to cross.',
    source: 'Biology XI · page 86',
    video: video('Diffusion vs facilitated diffusion', '4:30'),
  },
  {
    id: 'q6',
    stem: 'Ions such as K+ cross the plasma membrane mainly through:',
    options: ['Cholesterol molecules', 'Glycolipids', 'Channel proteins', 'The phospholipid tails'],
    answerKey: 2,
    explanation: 'Charged ions cannot pass through the hydrophobic core of the bilayer, so they use channel (or carrier) proteins.',
    source: 'Biology XI · page 85',
    video: video('Membrane proteins and ion channels', '6:10'),
  },
  {
    id: 'q7',
    stem: 'A red blood cell placed in distilled water will:',
    options: ['Shrink', 'Stay the same', 'Swell and may burst', 'Lose all its solutes'],
    answerKey: 2,
    explanation:
      'Distilled water has a higher water potential than the cell, so water enters by osmosis; the cell swells and may burst (haemolysis).',
    source: 'Biology XI · page 87',
    video: video('Tonicity and red blood cells', '5:35'),
  },
  {
    id: 'q8',
    stem: 'A white blood cell engulfing a bacterium is an example of:',
    options: ['Pinocytosis', 'Phagocytosis', 'Exocytosis', 'Osmosis'],
    answerKey: 1,
    explanation: 'Phagocytosis ("cell eating") takes in large solid particles by wrapping the membrane around them.',
    source: 'Biology XI · page 89',
    video: video('Endocytosis and exocytosis', '6:50'),
  },
  {
    id: 'q9',
    stem: 'The main role of cholesterol in the plasma membrane is to:',
    options: ['Carry glucose', 'Regulate membrane fluidity', 'Pump sodium ions', 'Store energy'],
    answerKey: 1,
    explanation: 'Cholesterol sits between phospholipids and keeps the membrane stable and fluid over a range of temperatures.',
    source: 'Biology XI · page 84',
    video: video('Why membranes need cholesterol', '4:15'),
  },
  {
    id: 'q10',
    stem: 'Compared with the cell, a hypertonic solution has:',
    options: [
      'A lower solute concentration',
      'The same solute concentration',
      'A higher solute concentration, so water leaves the cell',
      'No solutes at all',
    ],
    answerKey: 2,
    explanation: 'In a hypertonic solution the water potential is lower outside the cell, so water moves out and the cell shrinks.',
    source: 'Biology XI · page 87',
    video: video('Hypertonic, hypotonic, isotonic', '7:40'),
  },
];

export const MOCK_QUIZ: QuizData = {
  topic: 'Biology · Cell transport',
  origin: 'Past paper (2024)',
  timeRemainingSeconds: 12 * 60 + 40, // 12:40, as in the mockup
  questions,
};

/** Same shape as the future API call: a Promise of typed data. */
export function loadMockQuiz(): Promise<QuizData> {
  return Promise.resolve(MOCK_QUIZ);
}
