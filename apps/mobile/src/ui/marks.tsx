import { Circle, Path, Svg, Text as SvgText } from "react-native-svg";
import { getChain, PREPARED_CHAINS } from "@knoad/wallet-core";

/** Six facets of the Ethereum diamond, in a 32px view. */
const ETH_FACETS = [
  { d: "M16.498 4v8.87l7.497 3.35z", opacity: 0.602 },
  { d: "M16.498 4 9 16.22l7.498-3.35z", opacity: 1 },
  { d: "M16.498 21.968v6.027L24 17.616z", opacity: 0.602 },
  { d: "M16.498 27.995v-6.028L9 17.616z", opacity: 1 },
  { d: "M16.498 20.573l7.497-4.353-7.497-3.348z", opacity: 0.2 },
  { d: "M9 16.22l7.498 4.353v-7.701z", opacity: 0.602 },
];

/** Published Base mark: the bar runs from the left edge to the center. */
const BASE_MARK = "M10.87 17.99c4.15 0 7.51-3.36 7.51-7.51 0-4.15-3.36-7.51-7.51-7.51-3.76 0-6.86 2.77-7.4 6.36h9.9v2.3H3.47c.54 3.59 3.64 6.36 7.4 6.36Z";

function nativeSymbol(chainId: number): string {
  return getChain(chainId)?.native.symbol ?? PREPARED_CHAINS.find((chain) => chain.chainId === chainId)?.native.symbol ?? "ETH";
}

export function ChainMark(props: { chainId: number; size?: number }) {
  const size = props.size ?? 28;
  if (props.chainId === 8453) return <BaseDisc size={size} color="#0052FF" />;
  if (props.chainId === 84532) return <BaseDisc size={size} color="#4D8DFF" />;
  const symbol = nativeSymbol(props.chainId);
  if (symbol !== "ETH") return <LetterDisc size={size} letter={symbol.slice(0, 1)} />;
  if (props.chainId === 11155111) return <EthDisc size={size} color="#8A7CF0" />;
  return <EthDisc size={size} color="#627EEA" />;
}

function LetterDisc(props: { size: number; letter: string }) {
  return (
    <Svg width={props.size} height={props.size} viewBox="0 0 32 32">
      <Circle cx="16" cy="16" r="16" fill="#243028" />
      <SvgText x="16" y="21" textAnchor="middle" fontSize="14" fontWeight="700" fill="#F5F8F6">
        {props.letter}
      </SvgText>
    </Svg>
  );
}

function EthDisc(props: { size: number; color: string }) {
  return (
    <Svg width={props.size} height={props.size} viewBox="0 0 32 32">
      <Circle cx="16" cy="16" r="16" fill={props.color} />
      {ETH_FACETS.map((facet) => (
        <Path key={facet.d} d={facet.d} fill="#FFFFFF" fillOpacity={facet.opacity} />
      ))}
    </Svg>
  );
}

function BaseDisc(props: { size: number; color: string }) {
  return (
    <Svg width={props.size} height={props.size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="12" fill={props.color} />
      <Path d={BASE_MARK} fill="#FFFFFF" />
    </Svg>
  );
}

export function TokenMark(props: { symbol: string; size?: number }) {
  const size = props.size ?? 40;
  if (props.symbol === "USDC") {
    return (
      <Svg width={size} height={size} viewBox="0 0 40 40">
        <Circle cx="20" cy="20" r="20" fill="#2775CA" />
        <SvgText x="20" y="25" textAnchor="middle" fontSize="16" fontWeight="700" fill="#FFFFFF">
          $
        </SvgText>
      </Svg>
    );
  }
  if (props.symbol === "WETH") {
    return (
      <Svg width={size} height={size} viewBox="0 0 40 40">
        <Circle cx="20" cy="20" r="18" fill="#161616" stroke="#F5F8F6" strokeWidth="2" />
        <Path d="M20 9 27 20l-7 3.2L13 20 20 9z" fill="#F5F8F6" />
        <Path d="M20 24.5 27 21.5 20 31 13 21.5 20 24.5z" fill="#A1AEA8" />
      </Svg>
    );
  }
  if (props.symbol !== "ETH") {
    return (
      <Svg width={size} height={size} viewBox="0 0 40 40">
        <Circle cx="20" cy="20" r="20" fill="#243028" />
        <SvgText x="20" y="26" textAnchor="middle" fontSize="16" fontWeight="700" fill="#F5F8F6">
          {props.symbol.slice(0, 1)}
        </SvgText>
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Circle cx="20" cy="20" r="20" fill="#627EEA" />
      <Path d="M20 8 28 20l-8 3.4L12 20 20 8z" fill="#FFFFFF" />
      <Path d="M20 25.2 28 22 20 32 12 22 20 25.2z" fill="#C7D2FF" />
    </Svg>
  );
}
