import { render } from 'preact';
import '@fontsource/big-shoulders-display/latin-800';
import '@fontsource/dm-sans/latin-400';
import '@fontsource/dm-sans/latin-500';
import '@fontsource/dm-sans/latin-700';
import './styles.css';
import App from './App';

render(<App />, document.getElementById('app')!);
