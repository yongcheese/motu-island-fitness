/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ⚠️ 這個檔案目前**沒有被掛載**。全樹沒有任何一處 import 它。
 *
 * 島嶼天氣本身是活的 —— 但玩家看到的是另外兩個東西：角落那張通知（UI/WeatherToast.tsx，換天氣
 * 時的一行字），以及 設定 · 一般 裡的「島嶼狀態」選擇器（UI/settings/GeneralCategory.tsx）。這
 * 個 widget 是更早的一版，把兩件事做在同一張常駐卡片上。
 *
 * 保留而不刪除，是因為這一輪的目標是整理資訊架構、不是砍功能。但它需要這段標註：一個沒有入口、
 * 卻跟現行 UI 長得很像的完整元件，是下一個人最容易誤以為自己正在改的東西。要復活它的話，先決定
 * 它跟 WeatherToast 之間誰是唯一的天氣入口 —— 兩個都掛上去，就是同一件事有兩個答案。
 */

import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { WeatherType, View } from '../../types';
import { Sun, CloudRain, CloudLightning, Snowflake, Sunset, Moon, RefreshCw, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { playSound, SoundEffect } from '../../lib/soundUtils';

const weatherOrder = [
  WeatherType.SUNNY,
  WeatherType.RAINY,
  WeatherType.STORM,
  WeatherType.SNOW,
  WeatherType.TWILIGHT
];

export function AnimatedWeatherIcon({ type, size = 16, className = '', isActive = true }: { type: WeatherType; size?: number; className?: string; isActive?: boolean }) {
  const iconMap = {
    [WeatherType.SUNNY]: Sun,
    [WeatherType.RAINY]: CloudRain,
    [WeatherType.STORM]: CloudLightning,
    [WeatherType.SNOW]: Snowflake,
    [WeatherType.TWILIGHT]: Sunset,
    [WeatherType.MIDNIGHT]: Moon,
  };
  
  const IconComponent = iconMap[type] || Sun;
  
  if (!isActive) {
    return <IconComponent size={size} className={className} />;
  }

  let animateProps = {};
  let transitionProps = {};
  
  switch (type) {
    case WeatherType.SUNNY:
      animateProps = {
        rotate: 360,
        scale: [1, 1.15, 1]
      };
      transitionProps = {
        rotate: {
          repeat: Infinity,
          duration: 8,
          ease: "linear"
        },
        scale: {
          repeat: Infinity,
          duration: 3,
          ease: "easeInOut"
        }
      };
      break;
      
    case WeatherType.RAINY:
      animateProps = {
        y: [0, -2, 1, 0],
        scale: [1, 1.05, 1]
      };
      transitionProps = {
        y: {
          repeat: Infinity,
          duration: 2,
          ease: "easeInOut"
        },
        scale: {
          repeat: Infinity,
          duration: 2,
          ease: "easeInOut"
        }
      };
      break;
      
    case WeatherType.STORM:
      animateProps = {
        scale: [1, 1.2, 0.95, 1.1, 1],
        rotate: [0, -8, 8, -4, 4, 0],
        opacity: [1, 0.8, 1, 0.85, 1]
      };
      transitionProps = {
        scale: {
          repeat: Infinity,
          duration: 2.2,
          ease: "easeInOut",
          repeatDelay: 1
        },
        rotate: {
          repeat: Infinity,
          duration: 1.8,
          ease: "easeInOut",
          repeatDelay: 1
        },
        opacity: {
          repeat: Infinity,
          duration: 0.6,
          ease: "linear"
        }
      };
      break;
      
    case WeatherType.SNOW:
      animateProps = {
        rotate: [0, 30, -30, 0],
        scale: [1, 1.1, 1]
      };
      transitionProps = {
        rotate: {
          repeat: Infinity,
          duration: 5,
          ease: "easeInOut"
        },
        scale: {
          repeat: Infinity,
          duration: 3,
          ease: "easeInOut"
        }
      };
      break;
      
    case WeatherType.TWILIGHT:
      animateProps = {
        y: [0, -2, 0],
        scale: [1, 1.12, 1],
        filter: [
          "drop-shadow(0px 0px 0px rgba(249,115,22,0))", 
          "drop-shadow(0px 3px 6px rgba(249,115,22,0.4))", 
          "drop-shadow(0px 0px 0px rgba(249,115,22,0))"
        ]
      };
      transitionProps = {
        y: {
          repeat: Infinity,
          duration: 3,
          ease: "easeInOut"
        },
        scale: {
          repeat: Infinity,
          duration: 3,
          ease: "easeInOut"
        },
        filter: {
          repeat: Infinity,
          duration: 3,
          ease: "easeInOut"
        }
      };
      break;
      
    default:
      animateProps = { scale: [1, 1.05, 1] };
      transitionProps = { repeat: Infinity, duration: 2 };
  }

  return (
    <motion.span
      animate={animateProps}
      // @ts-ignore
      transition={transitionProps}
      className={`inline-flex items-center justify-center ${className}`}
    >
      <IconComponent size={size} />
    </motion.span>
  );
}

export function WeatherWidget() {
  const { weather, setWeather, currentView } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const [timeLeft, setTimeLeft] = useState(60);
  const [isAuto, setIsAuto] = useState(true);
  const [announcement, setAnnouncement] = useState<string | null>(null);

  const [isSyncActive, setIsSyncActive] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncData, setSyncData] = useState<{
    city: string;
    temp: number;
    wmoDescription: string;
  } | null>(null);

  const handleWeatherSync = async (active: boolean) => {
    setIsSyncActive(active);
    if (!active) {
      setSyncData(null);
      return;
    }

    setIsAuto(false);
    setSyncLoading(true);

    try {
      let lat = 25.0330;
      let lon = 121.5654;
      let cityName = "台北市";

      try {
        const geoRes = await fetch('https://ipapi.co/json/');
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          if (geoData.latitude && geoData.longitude) {
            lat = geoData.latitude;
            lon = geoData.longitude;
            cityName = geoData.city || geoData.region || "當前位置";
          }
        }
      } catch (e) {
        console.warn("IP Geolocation fetch failed, using fallback/navigator:", e);
      }

      if (navigator.geolocation) {
        const getCoords = () => new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 4000 });
        });
        try {
          const pos = await getCoords();
          lat = pos.coords.latitude;
          lon = pos.coords.longitude;
          cityName = "當前位置";
        } catch (e) {
          console.log("Navigator Geolocation failed or timed out, keeping IP city:", cityName);
        }
      }

      const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=weather_code,is_day,temperature_2m`);
      if (!weatherRes.ok) throw new Error("Weather API failed");
      
      const weatherData = await weatherRes.json();
      const code = weatherData.current.weather_code;
      const isDay = weatherData.current.is_day;
      const temp = weatherData.current.temperature_2m;

      let mappedType = WeatherType.SUNNY;
      let wmoDesc = "晴朗暖陽";

      if (isDay === 0) {
        mappedType = WeatherType.TWILIGHT;
        wmoDesc = "夜幕暮色";
      } else {
        if ([0, 1].includes(code)) {
          mappedType = WeatherType.SUNNY;
          wmoDesc = "晴空萬里";
        } else if ([2, 3].includes(code)) {
          mappedType = WeatherType.TWILIGHT;
          wmoDesc = "多雲多霧";
        } else if ([45, 48].includes(code)) {
          mappedType = WeatherType.TWILIGHT;
          wmoDesc = "濃霧瀰漫";
        } else if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) {
          mappedType = WeatherType.RAINY;
          wmoDesc = "陰雨綿綿";
        } else if ([95, 96, 99].includes(code)) {
          mappedType = WeatherType.STORM;
          wmoDesc = "雷雨狂風";
        } else if ([56, 57, 66, 67, 71, 73, 75, 77, 85, 86].includes(code)) {
          mappedType = WeatherType.SNOW;
          wmoDesc = "白雪皚皚";
        }
      }

      setWeather(mappedType);
      setSyncData({
        city: cityName,
        temp: Math.round(temp),
        wmoDescription: wmoDesc
      });

    } catch (err) {
      console.error("Real-world weather sync error:", err);
    } finally {
      setSyncLoading(false);
    }
  };

  useEffect(() => {
    if (!isSyncActive) return;
    
    const interval = setInterval(() => {
      handleWeatherSync(true);
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [isSyncActive]);

  const weatherOptions = [
    { 
      type: WeatherType.SUNNY, 
      label: '晴空萬里', 
      icon: Sun, 
      color: 'text-amber-400 hover:bg-amber-400/10 hover:border-amber-400/20', 
      activeBg: 'bg-amber-400 text-slate-900 shadow-[0_4px_15px_rgba(251,191,36,0.35)]' 
    },
    { 
      type: WeatherType.RAINY, 
      label: '細雨綿綿', 
      icon: CloudRain, 
      color: 'text-blue-400 hover:bg-blue-400/10 hover:border-blue-400/20', 
      activeBg: 'bg-blue-500 text-white shadow-[0_4px_15px_rgba(59,130,246,0.35)]' 
    },
    { 
      type: WeatherType.STORM, 
      label: '狂風暴雨', 
      icon: CloudLightning, 
      color: 'text-purple-400 hover:bg-purple-400/10 hover:border-purple-400/20', 
      activeBg: 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-[0_4px_15px_rgba(147,51,234,0.35)]' 
    },
    { 
      type: WeatherType.SNOW, 
      label: '瑞雪紛飛', 
      icon: Snowflake, 
      color: 'text-sky-300 hover:bg-sky-300/10 hover:border-sky-300/20', 
      activeBg: 'bg-sky-400 text-slate-900 shadow-[0_4px_15px_rgba(56,189,248,0.35)]' 
    },
    { 
      type: WeatherType.TWILIGHT, 
      label: '暮色餘暉', 
      icon: Sunset, 
      color: 'text-orange-400 hover:bg-orange-400/10 hover:border-orange-400/20', 
      activeBg: 'bg-orange-500 text-white shadow-[0_4px_15px_rgba(249,115,22,0.35)]' 
    },
  ];

  // 1-minute automatic cycle timer
  useEffect(() => {
    if (!isAuto) return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          return 0; // Trigger transition in the effect below
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isAuto]);

  // Handle automatic weather transition when timeLeft reaches 0
  useEffect(() => {
    if (isAuto && timeLeft === 0) {
      const currentIndex = weatherOrder.indexOf(weather);
      const nextIndex = (currentIndex + 1) % weatherOrder.length;
      setWeather(weatherOrder[nextIndex]);
      setTimeLeft(60);
    }
  }, [timeLeft, isAuto, weather, setWeather]);

  // Show beautiful announcement when weather changes
  useEffect(() => {
    const currentOption = weatherOptions.find(o => o.type === weather);
    if (currentOption) {
      setAnnouncement(currentOption.label);
      const audioToPlay = weather === WeatherType.STORM ? SoundEffect.CLICK : SoundEffect.CLICK;
      playSound(audioToPlay);
      const timer = setTimeout(() => {
        setAnnouncement(null);
      }, 4500);
      return () => clearTimeout(timer);
    }
  }, [weather]);

  // Handle manual select
  const handleSelect = (type: WeatherType) => {
    playSound(SoundEffect.CLICK);
    setWeather(type);
    setTimeLeft(60); // Reset timer to give a full minute immediately
    setIsOpen(false);
  };

  // Only display in standard Home View
  if (currentView !== View.HOME) {
    return null;
  }

  const currentOption = weatherOptions.find(o => o.type === weather) || weatherOptions[0];

  return (
    <>
      {/* Dynamic Poetic Screen Announcement */}
      <AnimatePresence>
        {announcement && (
          <motion.div
            initial={{ opacity: 0, y: -45, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -25, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 100, damping: 15 }}
            className="fixed top-24 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-1 px-8 py-4 bg-slate-950/85 backdrop-blur-3xl border border-white/10 rounded-2xl shadow-[0_30px_60px_rgba(0,0,0,0.6)] text-center max-w-[90vw] pointer-events-none"
          >
            <div className="text-[9px] uppercase tracking-[0.25em] text-white/40 font-black font-mono">
              當前氣候轉變
            </div>
            <div className="text-xl font-black text-white tracking-wide flex items-center gap-2">
              <AnimatedWeatherIcon type={weather} size={18} className={currentOption.color.split(' ')[0]} isActive={true} />
              <span>{currentOption.label}</span>
            </div>
            <div className="text-xs text-white/70 max-w-sm tracking-wide font-medium leading-relaxed mt-1">
              {weather === WeatherType.SUNNY && "暖陽與微風拂面，空氣中漫漂著細緻的黃金花粉..."}
              {weather === WeatherType.RAINY && "煙雨濛濛落重湖，細水在灰藍色天宇輕灑..."}
              {weather === WeatherType.STORM && "狂風怒號、烏雲翻湧！電閃雷鳴驚現，暴雨橫掃整個島嶼！"}
              {weather === WeatherType.SNOW && "冷冽極光映照天際，冬雪隨浪漫正弦風動輕旋飄逸..."}
              {weather === WeatherType.TWILIGHT && "夕陽夕暮，漫天緋紅與紫霞交織，溫暖的餘燼粒子靜靜徐升..."}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="fixed top-2 right-2 md:top-4 md:right-4 z-[75] flex flex-col items-end gap-2 pointer-events-auto">
        {/* Primary Toggle Pill Button */}
        <button
          onClick={() => {
            playSound(SoundEffect.CLICK);
            setIsOpen(!isOpen);
          }}
          className={`relative overflow-hidden flex items-center gap-1.5 md:gap-2.5 px-3 py-2 md:px-4 md:py-2.5 bg-gradient-to-b backdrop-blur-2xl text-white font-bold rounded-2xl select-none transition-all active:scale-95 group hover:-translate-y-0.5 focus:outline-none border ${
            weather === WeatherType.SUNNY ? 'from-slate-950/90 via-slate-900/85 to-amber-950/25 border-amber-500/20 shadow-[0_8px_20px_rgba(251,191,36,0.15)] hover:border-amber-400/40' :
            weather === WeatherType.RAINY ? 'from-slate-950/90 via-slate-900/85 to-blue-950/25 border-blue-500/20 shadow-[0_8px_20px_rgba(59,130,246,0.15)] hover:border-blue-400/40' :
            weather === WeatherType.STORM ? 'from-slate-950/90 via-slate-900/85 to-purple-950/25 border-purple-500/20 shadow-[0_8px_20px_rgba(147,51,234,0.15)] hover:border-purple-400/40' :
            weather === WeatherType.SNOW ? 'from-slate-950/90 via-slate-900/85 to-sky-950/25 border-sky-400/25 shadow-[0_8px_20px_rgba(56,189,248,0.12)] hover:border-sky-300/40' :
            'from-slate-950/90 via-slate-900/85 to-orange-950/25 border-orange-500/20 shadow-[0_8px_20px_rgba(249,115,22,0.15)] hover:border-orange-400/40'
          }`}
        >
          {/* Subtle top-light gradient glare on header */}
          <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent" />

          {/* Premium Ambient Shimmer Sweep Reflection */}
          <motion.div
            initial={{ left: '-100%' }}
            animate={{ left: '100%' }}
            transition={{
              repeat: Infinity,
              duration: 3,
              ease: "easeInOut",
              repeatDelay: 2
            }}
            className="absolute top-0 bottom-0 w-1/2 bg-gradient-to-r from-transparent via-white/5 to-transparent skew-x-12 pointer-events-none"
          />

          {/* Decorative weather live indicator glow dot */}
          <div className="absolute top-1.5 right-1.5 flex h-2 w-2">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
              weather === WeatherType.SUNNY ? 'bg-amber-400' :
              weather === WeatherType.RAINY ? 'bg-blue-400' :
              weather === WeatherType.STORM ? 'bg-purple-400' :
              weather === WeatherType.SNOW ? 'bg-sky-300' :
              'bg-orange-400'
            }`} />
            <span className={`relative inline-flex rounded-full h-2 w-2 ${
              weather === WeatherType.SUNNY ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]' :
              weather === WeatherType.RAINY ? 'bg-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.8)]' :
              weather === WeatherType.STORM ? 'bg-purple-400 shadow-[0_0_8px_rgba(147,51,234,0.8)]' :
              weather === WeatherType.SNOW ? 'bg-sky-300 shadow-[0_0_8px_rgba(56,189,248,0.8)]' :
              'bg-orange-400 shadow-[0_0_8px_rgba(249,115,22,0.8)]'
            }`} />
          </div>

          <AnimatedWeatherIcon type={weather} size={15} className={currentOption.color.split(' ')[0]} isActive={true} />
          <span className="text-xs font-black tracking-widest text-white/95 hidden sm:inline ml-0.5">{currentOption.label}</span>
          
          {isAuto && (
            <span className="text-[10px] font-mono font-bold text-white/50 ml-1 px-1.5 py-0.5 bg-white/10 rounded-md hidden sm:inline-block border border-white/5">
              {timeLeft}s
            </span>
          )}

          {/* Hardened Premium weather-themed progress loader bar with light glow glow */}
          {isAuto && (
            <div 
              className={`absolute bottom-0 left-0 h-[2.5px] bg-gradient-to-r transition-all duration-1000 ease-linear rounded-b-2xl ${
                weather === WeatherType.SUNNY ? 'from-amber-500 via-amber-400 to-amber-300 shadow-[0_-1px_4px_rgba(251,191,36,0.6)]' :
                weather === WeatherType.RAINY ? 'from-blue-500 via-blue-400 to-blue-300 shadow-[0_-1px_4px_rgba(59,130,246,0.6)]' :
                weather === WeatherType.STORM ? 'from-purple-600 via-fuchsia-500 to-indigo-500 shadow-[0_-1px_4px_rgba(147,51,234,0.6)]' :
                weather === WeatherType.SNOW ? 'from-sky-500 via-sky-400 to-teal-400 shadow-[0_-1px_4px_rgba(56,189,248,0.6)]' :
                'from-orange-500 via-orange-400 to-yellow-500 shadow-[0_-1px_4px_rgba(249,115,22,0.6)]'
              }`} 
              style={{ width: `${(timeLeft / 60) * 100}%` }} 
            />
          )}
        </button>

        {/* Expanded Weather Drawer Selection */}
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="flex flex-col gap-1.5 p-2 bg-slate-950/90 backdrop-blur-3xl border border-white/10 rounded-2xl shadow-[0_24px_60px_rgba(0,0,0,0.6)] w-48 relative overflow-hidden"
            >
              {/* Drawer Top Glow Effect */}
              <div className="absolute top-0 inset-x-0 h-10 bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />

              <div className="relative text-[10px] text-white/50 font-black px-3 py-2 uppercase tracking-[0.25em] text-center select-none flex items-center justify-center gap-2 overflow-hidden">
                <span className="w-1 h-1 bg-white/30 rounded-full animate-pulse" />
                <span>選擇氣候環境</span>
                <span className="w-1 h-1 bg-white/30 rounded-full animate-pulse" />
                {/* Horizontal bottom line decoration */}
                <div className="absolute bottom-0 inset-x-2 h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
              </div>
              
              <div className="flex flex-col gap-1 mt-1">
                {weatherOptions.map((opt) => {
                  const isActive = weather === opt.type;
                  return (
                    <button
                      key={opt.type}
                      onClick={() => handleSelect(opt.type)}
                      className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-black transition-all group overflow-hidden ${
                        isActive 
                          ? `${opt.activeBg} font-extrabold scale-[1.02]` 
                          : `text-white/60 hover:text-white border border-transparent hover:bg-white/5 ${opt.color.split(' ').slice(1).join(' ')}`
                      }`}
                    >
                      {/* Interactive hover glow highlight inside buttons */}
                      {!isActive && (
                        <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/5 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 ease-out" />
                      )}
                      
                      <AnimatedWeatherIcon type={opt.type} size={17} isActive={isActive} className={isActive ? "" : opt.color.split(' ')[0]} />
                      <span className="tracking-wide">{opt.label}</span>

                      {/* Small glowing trailing circle for selected climate */}
                      {isActive && (
                        <motion.div 
                          layoutId="activeIndicator"
                          className="absolute right-3.5 w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)]"
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Automatic Cycle Toggle Switch */}
              <div className="mt-1 pt-2 border-t border-white/5 px-2 flex items-center justify-between gap-2">
                <span className="text-[10px] text-white/50 font-black flex items-center gap-1 select-none">
                  <RefreshCw size={10} className={isAuto ? "animate-spin" : ""} style={{ animationDuration: '4s' }} />
                  自動變換 (1分)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    playSound(SoundEffect.CLICK);
                    setIsAuto(!isAuto);
                    if (!isAuto) setTimeLeft(60);
                    // Turn off weather sync if auto is toggled on
                    if (!isAuto) setIsSyncActive(false);
                  }}
                  className={`relative w-8 h-4.5 rounded-full p-0.5 transition-colors duration-300 pointer-events-auto ${
                    isAuto ? 'bg-gradient-to-r from-teal-400 to-sky-400' : 'bg-white/20'
                  }`}
                >
                  <div
                    className={`bg-white w-3.5 h-3.5 rounded-full shadow-md transform transition-transform duration-300 ${
                      isAuto ? 'translate-x-3.5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Real-world Weather Sync Toggle Switch */}
              <div className="mt-1 pt-2 border-t border-white/5 px-2 flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-white/50 font-black flex items-center gap-1 select-none">
                    <Clock size={10} className={isSyncActive ? "animate-pulse text-amber-400" : ""} />
                    真實世界天氣同步
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      playSound(SoundEffect.CLICK);
                      const nextVal = !isSyncActive;
                      handleWeatherSync(nextVal);
                    }}
                    disabled={syncLoading}
                    className={`relative w-8 h-4.5 rounded-full p-0.5 transition-colors duration-300 pointer-events-auto ${
                      isSyncActive ? 'bg-gradient-to-r from-amber-400 to-orange-500' : 'bg-white/20'
                    }`}
                  >
                    <div
                      className={`bg-white w-3.5 h-3.5 rounded-full shadow-md transform transition-transform duration-300 ${
                        isSyncActive ? 'translate-x-3.5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Loading / Synced Info Display */}
                {syncLoading && (
                  <div className="text-[9px] font-mono font-bold text-white/40 italic flex items-center gap-1.5 px-1 py-0.5">
                    <span className="inline-block w-2.5 h-2.5 rounded-full border border-white/30 border-t-white animate-spin" />
                    獲取當前氣象中...
                  </div>
                )}

                {!syncLoading && syncData && (
                  <div className="text-[9px] font-mono font-bold text-amber-300/90 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-lg flex flex-col gap-0.5 mt-0.5 shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-white/80 font-black">📍 {syncData.city}</span>
                      <span className="font-extrabold">{syncData.temp}°C</span>
                    </div>
                    <div className="text-white/40 text-[8px] tracking-wider uppercase font-black">
                      氣象狀態：<span className="text-amber-400 font-bold">{syncData.wmoDescription}</span>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
