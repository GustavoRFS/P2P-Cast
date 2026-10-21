// Gives native builds the synchronous window.localStorage the shared modules in src/lib expect
// (capture settings, viewer name/id, broadcast id), backed by SQLite.
import "expo-sqlite/localStorage/install";
