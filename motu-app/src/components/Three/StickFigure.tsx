import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface StickFigureProps {
  type: 'jumping-jacks' | 'squats' | 'idle';
  scale?: number;
}

export function StickFigure({ type, scale = 1 }: StickFigureProps) {
  const groupRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    const time = state.clock.getElapsedTime();
    
    if (type === 'jumping-jacks') {
      const cycle = Math.sin(time * 4);
      const angle = (cycle + 1) * (Math.PI / 2.5); // 0 to ~72 degrees
      
      if (leftArmRef.current) leftArmRef.current.rotation.z = angle;
      if (rightArmRef.current) rightArmRef.current.rotation.z = -angle;
      
      const legAngle = (cycle + 1) * (Math.PI / 8);
      if (leftLegRef.current) leftLegRef.current.rotation.z = legAngle;
      if (rightLegRef.current) rightLegRef.current.rotation.z = -legAngle;
      
      if (groupRef.current) {
        groupRef.current.position.y = Math.abs(cycle) * 0.2;
      }
    } else if (type === 'squats') {
      const cycle = Math.sin(time * 2);
      const squatDepth = (cycle + 1) * 0.3; // 0 to 0.6
      
      if (groupRef.current) {
        groupRef.current.position.y = -squatDepth;
      }
      
      if (leftArmRef.current) leftArmRef.current.rotation.x = -Math.PI / 2;
      if (rightArmRef.current) rightArmRef.current.rotation.x = -Math.PI / 2;
    }
  });

  const boneColor = "#ffffff";
  const jointColor = "#e2e8f0";

  return (
    <group ref={groupRef} scale={scale}>
      {/* Head */}
      <mesh position={[0, 1.6, 0]}>
        <sphereGeometry args={[0.2, 16, 16]} />
        <meshStandardMaterial color={boneColor} />
      </mesh>

      {/* Torso */}
      <mesh position={[0, 1.1, 0]}>
        <capsuleGeometry args={[0.05, 0.6, 4, 8]} />
        <meshStandardMaterial color={boneColor} />
      </mesh>

      {/* Shoulders */}
      <mesh position={[0, 1.4, 0]} rotation={[0, 0, Math.PI / 2]}>
        <capsuleGeometry args={[0.04, 0.4, 4, 8]} />
        <meshStandardMaterial color={boneColor} />
      </mesh>

      {/* Left Arm */}
      <group ref={leftArmRef} position={[-0.2, 1.4, 0]}>
        <group position={[-0.2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <mesh castShadow>
            <capsuleGeometry args={[0.04, 0.3, 4, 8]} />
            <meshStandardMaterial color={boneColor} />
          </mesh>
        </group>
      </group>

      {/* Right Arm */}
      <group ref={rightArmRef} position={[0.2, 1.4, 0]}>
        <group position={[0.2, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <mesh castShadow>
            <capsuleGeometry args={[0.04, 0.3, 4, 8]} />
            <meshStandardMaterial color={boneColor} />
          </mesh>
        </group>
      </group>

      {/* Hips */}
      <mesh position={[0, 0.8, 0]} rotation={[0, 0, Math.PI / 2]}>
        <capsuleGeometry args={[0.04, 0.2, 4, 8]} />
        <meshStandardMaterial color={boneColor} />
      </mesh>

      {/* Left Leg */}
      <group ref={leftLegRef} position={[-0.1, 0.8, 0]}>
        <group position={[0, -0.3, 0]}>
          <mesh castShadow>
            <capsuleGeometry args={[0.05, 0.5, 4, 8]} />
            <meshStandardMaterial color={boneColor} />
          </mesh>
        </group>
      </group>

      {/* Right Leg */}
      <group ref={rightLegRef} position={[0.1, 0.8, 0]}>
        <group position={[0, -0.3, 0]}>
          <mesh castShadow>
            <capsuleGeometry args={[0.05, 0.5, 4, 8]} />
            <meshStandardMaterial color={boneColor} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
