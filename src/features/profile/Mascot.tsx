import { useId } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import type { ProfileConfig } from "@/features/profile/types";
import { getColor } from "@/features/profile/options";

// All layers render inside a 200x200 viewBox.

function Body({
  shape,
  main,
  shade,
  showShadow,
}: {
  shape: ProfileConfig["body"];
  main: string;
  shade: string;
  showShadow: boolean;
}) {
  const shadowId = useId();
  const variants: Record<ProfileConfig["body"], { rx: number; ry: number; cy: number }> = {
    round: { rx: 60, ry: 64, cy: 110 },
    tall: { rx: 50, ry: 72, cy: 108 },
    short: { rx: 68, ry: 54, cy: 118 },
    blob: { rx: 64, ry: 60, cy: 112 },
    bean: { rx: 58, ry: 66, cy: 112 },
    star: { rx: 70, ry: 70, cy: 110 },
    egg: { rx: 54, ry: 70, cy: 112 },
    diamond: { rx: 64, ry: 70, cy: 110 },
    heart: { rx: 66, ry: 64, cy: 112 },
  };
  const v = variants[shape];

  const renderShape = (fill = main) => {
    if (shape === "blob") {
      return (
        <path
          d="M40,90 C40,60 70,46 100,46 C132,46 162,62 162,94 C162,128 138,168 100,168 C62,168 40,134 40,98 Z"
          fill={fill}
        />
      );
    }
    if (shape === "bean") {
      return (
        <path
          d="M58 78 Q40 110 58 150 Q80 178 120 170 Q160 162 158 120 Q156 78 130 60 Q92 42 58 78 Z"
          fill={fill}
        />
      );
    }
    if (shape === "star") {
      return (
        <path
          d="M100 44 L116 86 L162 88 L126 116 L138 160 L100 134 L62 160 L74 116 L38 88 L84 86 Z"
          fill={fill}
        />
      );
    }
    if (shape === "egg") {
      return (
        <path
          d="M100 46 C70 46 52 90 52 130 C52 162 74 178 100 178 C126 178 148 162 148 130 C148 90 130 46 100 46 Z"
          fill={fill}
        />
      );
    }
    if (shape === "diamond") {
      return <path d="M100 44 L164 110 L100 176 L36 110 Z" fill={fill} />;
    }
    if (shape === "heart") {
      return (
        <path
          d="M100 176 C60 148 36 124 36 92 C36 70 54 56 74 56 C86 56 96 62 100 72 C104 62 114 56 126 56 C146 56 164 70 164 92 C164 124 140 148 100 176 Z"
          fill={fill}
        />
      );
    }
    return <ellipse cx={100} cy={v.cy} rx={v.rx} ry={v.ry} fill={fill} />;
  };

  const specialShadow = shape === "star" || shape === "diamond" || shape === "heart";

  return (
    <motion.g
      key={shape}
      initial={{ scale: 0.85, y: 4 }}
      animate={{ scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 18 }}
    >
      {specialShadow && showShadow && (
        <defs>
          <filter id={shadowId} x="-30%" y="-30%" width="160%" height="180%">
            <feDropShadow dx="0" dy="7" stdDeviation="3" floodColor={shade} floodOpacity="0.42" />
          </filter>
        </defs>
      )}
      <g filter={specialShadow && showShadow ? `url(#${shadowId})` : undefined}>{renderShape()}</g>
      {!specialShadow && showShadow && (
        <ellipse cx={100} cy={v.cy + v.ry - 18} rx={v.rx - 6} ry={14} fill={shade} opacity={0.35} />
      )}
      <ellipse
        cx={100 - v.rx / 2.5}
        cy={v.cy - v.ry / 2.2}
        rx={14}
        ry={8}
        fill="#ffffff"
        opacity={0.35}
      />
    </motion.g>
  );
}

function Face({ expression }: { expression: ProfileConfig["expression"] }) {
  const stroke = "#0f172a";

  const eyes = (() => {
    switch (expression) {
      case "happy":
        return (
          <>
            <circle cx={80} cy={102} r={5} fill={stroke} />
            <circle cx={120} cy={102} r={5} fill={stroke} />
          </>
        );
      case "excited":
        return (
          <>
            <path
              d="M74 104 Q80 92 86 104"
              stroke={stroke}
              strokeWidth={4}
              fill="none"
              strokeLinecap="round"
            />
            <path
              d="M114 104 Q120 92 126 104"
              stroke={stroke}
              strokeWidth={4}
              fill="none"
              strokeLinecap="round"
            />
          </>
        );
      case "calm":
        return (
          <>
            <path
              d="M74 104 Q80 110 86 104"
              stroke={stroke}
              strokeWidth={4}
              fill="none"
              strokeLinecap="round"
            />
            <path
              d="M114 104 Q120 110 126 104"
              stroke={stroke}
              strokeWidth={4}
              fill="none"
              strokeLinecap="round"
            />
          </>
        );
      case "surprised":
        return (
          <>
            <circle cx={80} cy={102} r={7} fill="#fff" stroke={stroke} strokeWidth={3} />
            <circle cx={120} cy={102} r={7} fill="#fff" stroke={stroke} strokeWidth={3} />
            <circle cx={80} cy={102} r={3} fill={stroke} />
            <circle cx={120} cy={102} r={3} fill={stroke} />
          </>
        );
      case "smug":
        return (
          <>
            <path d="M73 102 L87 102" stroke={stroke} strokeWidth={4} strokeLinecap="round" />
            <path d="M113 102 L127 102" stroke={stroke} strokeWidth={4} strokeLinecap="round" />
          </>
        );
      case "sleepy":
        return (
          <>
            <path
              d="M73 104 Q80 108 87 104"
              stroke={stroke}
              strokeWidth={4}
              fill="none"
              strokeLinecap="round"
            />
            <path
              d="M113 104 Q120 108 127 104"
              stroke={stroke}
              strokeWidth={4}
              fill="none"
              strokeLinecap="round"
            />
          </>
        );
      case "love":
        return (
          <>
            <path
              d="M80 96 C76 92, 70 92, 70 98 C70 104, 80 110, 80 110 C80 110, 90 104, 90 98 C90 92, 84 92, 80 96 Z"
              fill="#ef4444"
            />
            <path
              d="M120 96 C116 92, 110 92, 110 98 C110 104, 120 110, 120 110 C120 110, 130 104, 130 98 C130 92, 124 92, 120 96 Z"
              fill="#ef4444"
            />
          </>
        );
      case "wink":
        return (
          <>
            <circle cx={80} cy={102} r={5} fill={stroke} />
            <path
              d="M113 104 Q120 100 127 104"
              stroke={stroke}
              strokeWidth={4}
              fill="none"
              strokeLinecap="round"
            />
          </>
        );
      case "cool":
        return (
          <>
            {/* sunglasses bar */}
            <rect x={66} y={96} width={68} height={12} rx={6} fill={stroke} />
            <rect x={70} y={99} width={24} height={6} rx={3} fill="#1e293b" />
            <rect x={106} y={99} width={24} height={6} rx={3} fill="#1e293b" />
            <rect x={73} y={100} width={6} height={2} rx={1} fill="#ffffff" opacity={0.7} />
            <rect x={109} y={100} width={6} height={2} rx={1} fill="#ffffff" opacity={0.7} />
          </>
        );
      case "angry":
        return (
          <>
            <path d="M70 94 L90 100" stroke={stroke} strokeWidth={4} strokeLinecap="round" />
            <path d="M130 94 L110 100" stroke={stroke} strokeWidth={4} strokeLinecap="round" />
            <circle cx={80} cy={106} r={4} fill={stroke} />
            <circle cx={120} cy={106} r={4} fill={stroke} />
          </>
        );
      case "sad":
        return (
          <>
            <path
              d="M74 100 Q80 108 86 100"
              stroke={stroke}
              strokeWidth={4}
              fill="none"
              strokeLinecap="round"
            />
            <path
              d="M114 100 Q120 108 126 100"
              stroke={stroke}
              strokeWidth={4}
              fill="none"
              strokeLinecap="round"
            />
            <ellipse cx={86} cy={114} rx={2.5} ry={5} fill="#38bdf8" />
          </>
        );
      case "tongue":
        return (
          <>
            <path
              d="M74 100 Q80 94 86 100"
              stroke={stroke}
              strokeWidth={4}
              fill="none"
              strokeLinecap="round"
            />
            <path
              d="M114 100 Q120 94 126 100"
              stroke={stroke}
              strokeWidth={4}
              fill="none"
              strokeLinecap="round"
            />
          </>
        );
      case "dizzy":
        return (
          <>
            <path
              d="M74 98 L86 106 M74 106 L86 98"
              stroke={stroke}
              strokeWidth={3}
              strokeLinecap="round"
            />
            <path
              d="M114 98 L126 106 M114 106 L126 98"
              stroke={stroke}
              strokeWidth={3}
              strokeLinecap="round"
            />
          </>
        );
    }
  })();

  const mouth = (() => {
    switch (expression) {
      case "happy":
        return (
          <path
            d="M88 124 Q100 134 112 124"
            stroke={stroke}
            strokeWidth={4}
            fill="none"
            strokeLinecap="round"
          />
        );
      case "excited":
        return <path d="M86 122 Q100 142 114 122 Z" fill={stroke} />;
      case "calm":
        return <path d="M90 126 L110 126" stroke={stroke} strokeWidth={4} strokeLinecap="round" />;
      case "surprised":
        return <ellipse cx={100} cy={128} rx={6} ry={8} fill={stroke} />;
      case "smug":
        return (
          <path
            d="M88 126 Q100 132 112 124"
            stroke={stroke}
            strokeWidth={4}
            fill="none"
            strokeLinecap="round"
          />
        );
      case "sleepy":
        return (
          <path
            d="M92 128 Q100 130 108 128"
            stroke={stroke}
            strokeWidth={4}
            fill="none"
            strokeLinecap="round"
          />
        );
      case "love":
        return (
          <path
            d="M86 124 Q100 138 114 124"
            stroke={stroke}
            strokeWidth={4}
            fill="none"
            strokeLinecap="round"
          />
        );
      case "wink":
        return (
          <path
            d="M88 124 Q100 134 112 124"
            stroke={stroke}
            strokeWidth={4}
            fill="none"
            strokeLinecap="round"
          />
        );
      case "cool":
        return (
          <path
            d="M88 126 Q100 132 112 126"
            stroke={stroke}
            strokeWidth={4}
            fill="none"
            strokeLinecap="round"
          />
        );
      case "angry":
        return (
          <path
            d="M88 130 Q100 124 112 130"
            stroke={stroke}
            strokeWidth={4}
            fill="none"
            strokeLinecap="round"
          />
        );
      case "sad":
        return (
          <path
            d="M88 132 Q100 122 112 132"
            stroke={stroke}
            strokeWidth={4}
            fill="none"
            strokeLinecap="round"
          />
        );
      case "tongue":
        return (
          <>
            <path d="M86 122 Q100 138 114 122 Z" fill={stroke} />
            <path d="M96 132 Q100 142 108 134 L108 130 Q100 134 96 128 Z" fill="#f43f5e" />
          </>
        );
      case "dizzy":
        return (
          <path
            d="M86 128 Q92 122 98 128 Q104 134 110 128 Q114 124 116 128"
            stroke={stroke}
            strokeWidth={3}
            fill="none"
            strokeLinecap="round"
          />
        );
    }
  })();

  return (
    <AnimatePresence mode="wait">
      <motion.g
        key={expression}
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.6, opacity: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 20 }}
      >
        {expression !== "cool" && (
          <>
            <circle cx={72} cy={118} r={6} fill="#fb7185" opacity={0.55} />
            <circle cx={128} cy={118} r={6} fill="#fb7185" opacity={0.55} />
          </>
        )}
        {eyes}
        {mouth}
      </motion.g>
    </AnimatePresence>
  );
}

function Accessories({ list }: { list: ProfileConfig["accessories"] }) {
  return (
    <g>
      <AnimatePresence>
        {list.includes("backpack") && (
          <motion.g
            key="backpack"
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -20, opacity: 0 }}
          >
            <rect x={36} y={108} width={22} height={32} rx={6} fill="#ec4899" />
            <rect x={40} y={116} width={14} height={4} rx={2} fill="#fff" opacity={0.6} />
          </motion.g>
        )}
        {list.includes("scarf") && (
          <motion.g
            key="scarf"
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 8, opacity: 0 }}
          >
            <path d="M70 138 Q100 150 130 138 L132 152 Q100 162 68 152 Z" fill="#0d9488" />
            <path d="M126 150 L138 168 L132 170 L122 154 Z" fill="#0f766e" />
          </motion.g>
        )}
        {list.includes("mustache") && (
          <motion.g
            key="mustache"
            initial={{ y: -4, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -4, opacity: 0 }}
          >
            <path
              d="M82 118 Q90 112 100 116 Q110 112 118 118 Q114 124 108 122 Q104 121 100 122 Q96 121 92 122 Q86 124 82 118 Z"
              fill="#0f172a"
            />
          </motion.g>
        )}
        {list.includes("bowtie") && (
          <motion.g
            key="bowtie"
            initial={{ y: 6, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 6, opacity: 0 }}
          >
            <path d="M84 146 L100 152 L84 158 Z" fill="#ec4899" />
            <path d="M116 146 L100 152 L116 158 Z" fill="#ec4899" />
            <rect x={96} y={148} width={8} height={8} rx={2} fill="#be185d" />
          </motion.g>
        )}
        {list.includes("earrings") && (
          <motion.g
            key="earrings"
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.5, opacity: 0 }}
          >
            <circle cx={48} cy={124} r={4} fill="#facc15" stroke="#ca8a04" strokeWidth={1} />
            <circle cx={152} cy={124} r={4} fill="#facc15" stroke="#ca8a04" strokeWidth={1} />
          </motion.g>
        )}
        {list.includes("flower") && (
          <motion.g
            key="flower"
            initial={{ scale: 0, rotate: -30, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            style={{ transformOrigin: "62px 72px" }}
          >
            <circle cx={56} cy={68} r={5} fill="#f9a8d4" />
            <circle cx={68} cy={68} r={5} fill="#f9a8d4" />
            <circle cx={56} cy={78} r={5} fill="#f9a8d4" />
            <circle cx={68} cy={78} r={5} fill="#f9a8d4" />
            <circle cx={62} cy={73} r={5} fill="#fde047" />
          </motion.g>
        )}
        {list.includes("antenna") && (
          <motion.g
            key="antenna"
            initial={{ y: 6, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 6, opacity: 0 }}
          >
            <line
              x1={100}
              y1={56}
              x2={100}
              y2={32}
              stroke="#0f172a"
              strokeWidth={3}
              strokeLinecap="round"
            />
            <circle cx={100} cy={28} r={6} fill="#f97316" />
            <circle cx={100} cy={28} r={2} fill="#fff" opacity={0.7} />
          </motion.g>
        )}
        {list.includes("halo") && (
          <motion.g
            key="halo"
            initial={{ y: -6, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -6, opacity: 0 }}
          >
            <ellipse cx={100} cy={44} rx={32} ry={7} fill="none" stroke="#facc15" strokeWidth={4} />
            <ellipse
              cx={100}
              cy={44}
              rx={28}
              ry={4}
              fill="none"
              stroke="#fef08a"
              strokeWidth={2}
              opacity={0.8}
            />
          </motion.g>
        )}
        {list.includes("crown") && (
          <motion.g
            key="crown"
            initial={{ y: -10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -10, opacity: 0 }}
          >
            <path
              d="M60 70 L70 48 L84 62 L100 42 L116 62 L130 48 L140 70 Z"
              fill="#facc15"
              stroke="#ca8a04"
              strokeWidth={2}
              strokeLinejoin="round"
            />
            <circle cx={70} cy={50} r={3} fill="#ef4444" />
            <circle cx={100} cy={46} r={3} fill="#3b82f6" />
            <circle cx={130} cy={50} r={3} fill="#10b981" />
            <rect x={60} y={68} width={80} height={4} fill="#ca8a04" />
          </motion.g>
        )}
        {list.includes("glasses") && (
          <motion.g
            key="glasses"
            initial={{ y: -6, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -6, opacity: 0 }}
          >
            <circle
              cx={80}
              cy={102}
              r={12}
              fill="#fff"
              fillOpacity={0.2}
              stroke="#0f172a"
              strokeWidth={3}
            />
            <circle
              cx={120}
              cy={102}
              r={12}
              fill="#fff"
              fillOpacity={0.2}
              stroke="#0f172a"
              strokeWidth={3}
            />
            <path d="M92 102 L108 102" stroke="#0f172a" strokeWidth={3} strokeLinecap="round" />
            <path d="M68 100 L62 98" stroke="#0f172a" strokeWidth={3} strokeLinecap="round" />
            <path d="M132 100 L138 98" stroke="#0f172a" strokeWidth={3} strokeLinecap="round" />
          </motion.g>
        )}
        {list.includes("headphones") && (
          <motion.g
            key="headphones"
            initial={{ y: -8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -8, opacity: 0 }}
          >
            {/* band */}
            <path
              d="M 48 104 Q 48 52 100 52 Q 152 52 152 104"
              stroke="#0f172a"
              strokeWidth={9}
              fill="none"
              strokeLinecap="round"
            />
            <path
              d="M 52 96 Q 54 60 100 58"
              stroke="#475569"
              strokeWidth={2}
              fill="none"
              strokeLinecap="round"
              opacity={0.6}
            />
            {/* left cup */}
            <ellipse cx={48} cy={106} rx={14} ry={17} fill="#0f172a" />
            <ellipse cx={48} cy={106} rx={9} ry={12} fill="#f97316" />
            <ellipse cx={45} cy={102} rx={3} ry={4} fill="#fff" opacity={0.4} />
            {/* right cup */}
            <ellipse cx={152} cy={106} rx={14} ry={17} fill="#0f172a" />
            <ellipse cx={152} cy={106} rx={9} ry={12} fill="#f97316" />
            <ellipse cx={149} cy={102} rx={3} ry={4} fill="#fff" opacity={0.4} />
          </motion.g>
        )}
        {list.includes("cap") && (
          <motion.g
            key="cap"
            initial={{ y: -12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -12, opacity: 0 }}
          >
            <path d="M58 78 Q100 44 142 78 L142 86 L58 86 Z" fill="#ec4899" />
            <path d="M58 84 Q100 78 142 84 L158 96 L42 96 Z" fill="#be185d" />
            <circle cx={100} cy={66} r={4} fill="#fff" />
          </motion.g>
        )}
        {list.includes("beanie") && (
          <motion.g
            key="beanie"
            initial={{ y: -12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -12, opacity: 0 }}
          >
            <path d="M56 86 Q100 36 144 86 L144 92 L56 92 Z" fill="#0d9488" />
            <rect x={56} y={86} width={88} height={10} fill="#0f766e" />
            <circle cx={100} cy={40} r={8} fill="#fff" />
            <circle cx={100} cy={40} r={4} fill="#e2e8f0" />
          </motion.g>
        )}
        {list.includes("partyhat") && (
          <motion.g
            key="partyhat"
            initial={{ y: -14, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -14, opacity: 0 }}
          >
            <path d="M80 80 L100 24 L120 80 Z" fill="#ec4899" />
            <path d="M84 60 L116 60" stroke="#fff" strokeWidth={2} />
            <path d="M86 48 L114 48" stroke="#facc15" strokeWidth={2} />
            <circle cx={100} cy={22} r={4} fill="#facc15" />
          </motion.g>
        )}
        {list.includes("beard") && (
          <motion.g
            key="beard"
            initial={{ y: 6, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 6, opacity: 0 }}
          >
            <path
              d="M74 124 Q72 148 100 156 Q128 148 126 124 Q120 136 100 138 Q80 136 74 124 Z"
              fill="#475569"
            />
          </motion.g>
        )}
        {list.includes("monocle") && (
          <motion.g
            key="monocle"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
          >
            <circle
              cx={120}
              cy={102}
              r={13}
              fill="#fff"
              fillOpacity={0.25}
              stroke="#0f172a"
              strokeWidth={3}
            />
            <line x1={132} y1={114} x2={138} y2={130} stroke="#0f172a" strokeWidth={2} />
          </motion.g>
        )}
        {list.includes("eyepatch") && (
          <motion.g
            key="eyepatch"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
          >
            <path d="M60 96 L96 92 L96 112 L60 108 Z" fill="#0f172a" />
            <path d="M60 96 Q40 94 36 84" stroke="#0f172a" strokeWidth={3} fill="none" />
            <path d="M96 102 Q120 100 140 92" stroke="#0f172a" strokeWidth={3} fill="none" />
          </motion.g>
        )}
        {list.includes("tie") && (
          <motion.g
            key="tie"
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 8, opacity: 0 }}
          >
            <path d="M96 146 L104 146 L106 152 L100 158 L94 152 Z" fill="#ef4444" />
            <path d="M94 154 L100 168 L106 154 L102 168 L98 168 Z" fill="#b91c1c" />
          </motion.g>
        )}
      </AnimatePresence>
    </g>
  );
}

function Background({ kind, color }: { kind: ProfileConfig["background"]; color: string }) {
  const gradientId = useId();
  switch (kind) {
    case "gradient":
      return (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor="#fff" stopOpacity={0} />
            </linearGradient>
          </defs>
          <rect width={200} height={200} fill={`url(#${gradientId})`} />
        </>
      );
    case "bubbles":
      return (
        <g opacity={0.25}>
          <circle cx={30} cy={40} r={14} fill={color} />
          <circle cx={170} cy={60} r={10} fill={color} />
          <circle cx={40} cy={170} r={8} fill={color} />
          <circle cx={160} cy={160} r={16} fill={color} />
        </g>
      );
    case "waves":
      return (
        <g opacity={0.25}>
          <path d="M0 60 Q50 40 100 60 T200 60" stroke={color} strokeWidth={4} fill="none" />
          <path d="M0 100 Q50 80 100 100 T200 100" stroke={color} strokeWidth={4} fill="none" />
          <path d="M0 140 Q50 120 100 140 T200 140" stroke={color} strokeWidth={4} fill="none" />
        </g>
      );
    case "grid":
      return (
        <g opacity={0.18}>
          {[20, 60, 100, 140, 180].map((p) => (
            <line key={`h${p}`} x1={0} y1={p} x2={200} y2={p} stroke={color} strokeWidth={1} />
          ))}
          {[20, 60, 100, 140, 180].map((p) => (
            <line key={`v${p}`} x1={p} y1={0} x2={p} y2={200} stroke={color} strokeWidth={1} />
          ))}
        </g>
      );
    case "confetti":
      return (
        <g opacity={0.65}>
          <rect x={24} y={30} width={6} height={10} fill="#f97316" transform="rotate(20 24 30)" />
          <rect
            x={170}
            y={50}
            width={6}
            height={10}
            fill="#0d9488"
            transform="rotate(-30 170 50)"
          />
          <rect x={40} y={160} width={6} height={10} fill="#ec4899" transform="rotate(45 40 160)" />
          <rect
            x={160}
            y={170}
            width={6}
            height={10}
            fill="#8b5cf6"
            transform="rotate(-15 160 170)"
          />
          <rect x={100} y={20} width={6} height={10} fill="#0ea5e9" transform="rotate(10 100 20)" />
        </g>
      );
    case "stars":
      return (
        <g opacity={0.5} fill={color}>
          {[
            [30, 40],
            [170, 50],
            [50, 170],
            [160, 160],
            [20, 110],
            [180, 120],
            [110, 24],
          ].map(([x, y], i) => (
            <path
              key={i}
              d={`M${x} ${y - 5} L${x + 1.5} ${y - 1.5} L${x + 5} ${y} L${x + 1.5} ${y + 1.5} L${x} ${y + 5} L${x - 1.5} ${y + 1.5} L${x - 5} ${y} L${x - 1.5} ${y - 1.5} Z`}
            />
          ))}
        </g>
      );
    case "stripes":
      return (
        <g opacity={0.15}>
          {[-40, 0, 40, 80, 120, 160, 200].map((x) => (
            <rect
              key={x}
              x={x}
              y={-20}
              width={20}
              height={260}
              fill={color}
              transform={`rotate(20 ${x} 100)`}
            />
          ))}
        </g>
      );
    case "rays":
      return (
        <g opacity={0.18}>
          {Array.from({ length: 12 }).map((_, i) => {
            const angle = (i * 30 * Math.PI) / 180;
            const x = 100 + Math.cos(angle) * 200;
            const y = 100 + Math.sin(angle) * 200;
            return <line key={i} x1={100} y1={100} x2={x} y2={y} stroke={color} strokeWidth={8} />;
          })}
        </g>
      );
    case "dots":
      return (
        <g opacity={0.25} fill={color}>
          {[20, 50, 80, 110, 140, 170, 200].map((y) =>
            [20, 50, 80, 110, 140, 170, 200].map((x) => (
              <circle key={`${x}-${y}`} cx={x} cy={y} r={3} />
            )),
          )}
        </g>
      );
    case "hearts":
      return (
        <g opacity={0.35} fill={color}>
          {[
            [30, 40],
            [165, 55],
            [50, 165],
            [160, 155],
            [110, 28],
            [22, 110],
            [180, 120],
          ].map(([x, y], i) => (
            <path
              key={i}
              d={`M${x} ${y + 6} C${x - 8} ${y}, ${x - 8} ${y - 8}, ${x} ${y - 4} C${x + 8} ${y - 8}, ${x + 8} ${y}, ${x} ${y + 6} Z`}
            />
          ))}
        </g>
      );
    case "sparkles":
      return (
        <g opacity={0.6}>
          {[
            [30, 40, "#facc15"],
            [170, 50, "#38bdf8"],
            [50, 170, "#ec4899"],
            [160, 160, "#8b5cf6"],
            [110, 24, "#10b981"],
            [22, 100, "#f97316"],
          ].map(([x, y, c], i) => (
            <g key={i} fill={c as string}>
              <path
                d={`M${x} ${(y as number) - 8} L${(x as number) + 2} ${y} L${(x as number) + 8} ${(y as number) + 2} L${x} ${(y as number) + 2} L${(x as number) - 2} ${(y as number) + 8} L${(x as number) - 2} ${(y as number) + 2} L${(x as number) - 8} ${y} L${(x as number) - 2} ${(y as number) - 2} Z`}
              />
            </g>
          ))}
        </g>
      );
    case "plain":
    default:
      return null;
  }
}

export function Mascot({
  config,
  size = 240,
  animated = true,
  showShadow = true,
}: {
  config: ProfileConfig;
  size?: number;
  animated?: boolean;
  showShadow?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const color = getColor(config.color);
  return (
    <motion.svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      animate={animated && !reduceMotion ? { y: [0, -4, 0] } : { y: 0 }}
      transition={
        animated && !reduceMotion
          ? { duration: 3.2, repeat: Infinity, ease: "easeInOut" }
          : { duration: 0 }
      }
    >
      <Background kind={config.background} color={color.main} />
      <Body shape={config.body} main={color.main} shade={color.shade} showShadow={showShadow} />
      <Face expression={config.expression} />
      <Accessories list={config.accessories} />
    </motion.svg>
  );
}
