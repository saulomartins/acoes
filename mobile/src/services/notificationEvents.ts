type Listener = () => void;

const listeners = new Set<Listener>();

export const emitNotificationsChanged = () => {
  listeners.forEach((listener) => listener());
};

export const subscribeNotificationsChanged = (listener: Listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
