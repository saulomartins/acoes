import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Módulo próprio porque AppNavigator.tsx e o par ManagementStack.web/.native.tsx
// precisam registrar <Stack.Screen> do MESMO objeto Stack — o React Navigation
// reconhece uma tela pela identidade do componente Screen, não pelo nome.
export const Stack = createNativeStackNavigator();
