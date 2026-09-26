import React from 'react';
import { useApp } from '../context/AppContext';
import { motion, AnimatePresence } from 'motion/react';
import { LogIn } from 'lucide-react';
import { View } from '../types';
import { db, doc, updateDoc } from '../lib/firebase';
import { playSound, SoundEffect, triggerHaptic } from '../lib/soundUtils';

export function InteractionPrompt() {
  const { nearbyBuilding, setCurrentView, profile } = useApp();

  const handleEnter = async () => {
    if (!nearbyBuilding || !profile) return;
    
    try {
      playSound(SoundEffect.CLICK);
      triggerHaptic('double');
      const userRef = doc(db, 'users', profile.userId);
      await updateDoc(userRef, { activeBuildingId: nearbyBuilding.id });
      setCurrentView(View.BUILDING_INTERIOR);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <AnimatePresence>
      {nearbyBuilding && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="fixed bottom-32 left-1/2 -translate-x-1/2 z-[60]"
        >
          <button 
            onClick={handleEnter}
            className="bg-white/90 backdrop-blur-md border-2 border-amber-100 px-8 py-5 rounded-[2.5rem] shadow-2xl flex items-center gap-4 hover:-translate-y-1 active:scale-95 transition-all group"
          >
            <div className="w-14 h-14 bg-amber-500 rounded-2xl flex items-center justify-center text-white shadow-lg group-hover:rotate-12 transition-transform shadow-amber-500/20">
              <LogIn size={28} />
            </div>
            <div className="text-left">
              <p className="text-[10px] uppercase font-[1000] text-amber-500 tracking-widest leading-none mb-1">發現目標建築</p>
              <h3 className="text-gray-900 font-black text-2xl tracking-tight leading-none">進入 {nearbyBuilding.name}</h3>
            </div>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
