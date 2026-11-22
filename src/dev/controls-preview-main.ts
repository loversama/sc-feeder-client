/** Dev-only preview of the Controls page with the 5.0 PTU action list (no Electron). */
import { createApp } from 'vue';
import ControlsPage from '../pages/ControlsPage.vue';
import { installFixtureControlBridge } from './control-fixture-bridge';

installFixtureControlBridge(new URLSearchParams(location.search));
createApp(ControlsPage).mount('#app');
