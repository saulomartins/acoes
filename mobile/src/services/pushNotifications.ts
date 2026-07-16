import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { apiRequest } from '../api/client';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID
  || Constants.easConfig?.projectId
  || Constants.expoConfig?.extra?.eas?.projectId;

export const registerForPushNotifications = async (accessToken: string) => {
  if (Platform.OS === 'web' || !Device.isDevice) return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Avisos do condomínio',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#2563EB',
    });
  }

  const current = await Notifications.getPermissionsAsync();
  const permission = current.status === 'granted' ? current : await Notifications.requestPermissionsAsync();
  if (permission.status !== 'granted') return null;

  const pushToken = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  await apiRequest('/notifications/devices', accessToken, {
    method: 'POST',
    body: JSON.stringify({ pushToken, platform: Platform.OS }),
  });
  return pushToken;
};

export const unregisterPushNotifications = async (accessToken: string, pushToken: string) => {
  await apiRequest('/notifications/devices', accessToken, {
    method: 'DELETE',
    body: JSON.stringify({ pushToken }),
  });
};
