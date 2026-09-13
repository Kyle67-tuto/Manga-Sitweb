// =========================================================
// V scans — db.js
// Firebase (Auth, Firestore, Analytics) + ImgBB static config
// =========================================================

import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported as analyticsIsSupported } from "firebase/analytics";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "firebase/auth";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  addDoc,
  increment
} from "firebase/firestore";

// ---------- Firebase config (production) ----------
const firebaseConfig = {
  apiKey: "AIzaSyB9Z5Tjc0yWg69GlWdUBTZ9VgUcGrh5mMU",
  authDomain: "v-scans.firebaseapp.com",
  projectId: "v-scans",
  storageBucket: "v-scans.firebasestorage.app",
  messagingSenderId: "545198752043",
  appId: "1:545198752043:web:efdc1656b5fd4f354ec56e",
  measurementId: "G-NDQER8NPM9"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

// Analytics only works in a real browser context with support — guard it.
export let analytics = null;
analyticsIsSupported().then((supported) => {
  if (supported) analytics = getAnalytics(app);
});

// Re-export the Firestore/Auth helpers so app.js has one single import surface.
export {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  addDoc,
  increment,
  signInWithPopup,
  signOut,
  onAuthStateChanged
};

// ---------- ImgBB config ----------
export const IMGBB_API_KEY = "7d8f9e0a1b2c3d4e5f6a7b8c9d0e1f2a";

/**
 * Uploads a single File/Blob to ImgBB and resolves with the direct display URL.
 * @param {File} file
 * @returns {Promise<string>} the hosted image URL
 */
export async function uploadImageToImgbb(file) {
  const formData = new FormData();
  formData.append("image", file);

  const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
    method: "POST",
    body: formData
  });

  if (!res.ok) {
    throw new Error(`ImgBB upload failed with status ${res.status}`);
  }

  const json = await res.json();
  if (!json.success) {
    throw new Error("ImgBB upload was not successful.");
  }
  return json.data.url;
}

/**
 * Uploads multiple files concurrently to ImgBB.
 * @param {File[]} files
 * @param {(done:number, total:number)=>void} [onProgress]
 * @returns {Promise<string[]>} array of hosted URLs, in the same order as input files
 */
export async function uploadMultipleImagesToImgbb(files, onProgress) {
  let done = 0;
  const total = files.length;

  const uploads = files.map((file) =>
    uploadImageToImgbb(file).then((url) => {
      done += 1;
      if (onProgress) onProgress(done, total);
      return url;
    })
  );

  return Promise.all(uploads);
}

// ---------- Admin config ----------
export const ADMIN_EMAIL = "anwarbah96@gmail.com";
