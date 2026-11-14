import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { App } from './ui/app';
import './styles.css';

registerSW({ immediate: true });

const root = document.querySelector('#app');
if (root) render(<App />, root);
