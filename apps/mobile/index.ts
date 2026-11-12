// Polyfills must load before anything else.
import 'react-native-get-random-values';
import { registerGlobals } from '@livekit/react-native';
import { registerRootComponent } from 'expo';
import App from './App';

registerGlobals(); // WebRTC + livekit-client globals for React Native
registerRootComponent(App);
