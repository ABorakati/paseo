import Svg, { Path, Defs, LinearGradient, Stop } from "react-native-svg";

interface AntigravityIconProps {
  size?: number;
  color?: string;
}

export function AntigravityIcon({ size = 16 }: AntigravityIconProps) {
  return (
    <Svg width={size} height={size} viewBox="-2 -1 28 28" fill="none">
      <Path
        d="M21.751 22.607c1.34 1.005 3.35.335 1.508-1.508C17.73 15.74 18.904 1 12.037 1 5.17 1 6.342 15.74.815 21.1c-2.01 2.009.167 2.511 1.507 1.506 5.192-3.517 4.857-9.714 9.715-9.714 4.857 0 4.522 6.197 9.714 9.715z"
        fill="url(#ag)"
      />
      <Defs>
        <LinearGradient id="ag" x1="2" y1="12" x2="22" y2="12" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#4285F4" />
          <Stop offset="0.33" stopColor="#EA4335" />
          <Stop offset="0.66" stopColor="#FBBC04" />
          <Stop offset="1" stopColor="#34A853" />
        </LinearGradient>
      </Defs>
    </Svg>
  );
}
