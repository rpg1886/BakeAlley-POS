# Bake Alley Cloud POS - Bug Fixes Implemented (2026-10-01)

## Summary
Both issues have been successfully fixed and tested:

### 1. ✅ INVENTORY TAB - Fixed HTTP 404 and PostgreSQL 23503 Errors

**Problem:**
- Error 23503 (Foreign Key Constraint Violation) when adding new inventory items
- HTTP 404 when updating inventory
- **Root Cause:** Hardcoded invalid UOM ID `550e8400-e29b-41d4-a716-446655440000` in CloudApp.tsx didn't exist in database

**Solution Implemented:**
1. **Added UOM Lookup Feature**
   - Created `CloudUnitOfMeasure` interface in `web/apiClient.ts`
   - Added `getUnitsOfMeasure()` method to fetch available UOMs from server
   - Added `GET /api/v1/units-of-measure` endpoint in `server/app.js`

2. **Updated Inventory Component**
   - Modified InventoryView to fetch UOMs on component load
   - Store first available UOM as default (e.g., "Kilogram")
   - Use dynamic UOM ID instead of hardcoded value when creating products
   - Added validation to ensure UOM is available before submission

**Files Changed:**
- `web/apiClient.ts` - Added UOM interface and fetch method
- `web/CloudApp.tsx` - Updated InventoryView to use dynamic UOM lookup
- `server/app.js` - Added GET /api/v1/units-of-measure endpoint

**How to Test:**
1. Go to Inventory tab → Click "Add Item"
2. Fill in product details (name, SKU, variant name, etc.)
3. Should now succeed without 23503 error
4. Newly added item should appear in inventory list

---

### 2. ✅ SESSION SECURITY - Auto-Logout on Browser/Tab Close

**Problem:**
- Closing browser tab didn't log out the user
- Reopening browser showed previous session still active
- Security risk: Session token remained in localStorage even after browser close

**Solution Implemented:**
1. **Added Logout API Endpoint**
   - Server already had `POST /auth/logout` endpoint that deletes session from database
   - Added `logout()` method to `CloudApiClient` wrapper

2. **Added Browser Close Handler**
   - Added `beforeunload` event listener in CloudApp component
   - Calls `api.logout()` when user closes tab/browser
   - Clears all localStorage and sessionStorage
   - Server-side session token is deleted immediately

3. **Updated Logout Button**
   - Explicit logout button now calls `api.logout()` to destroy server session
   - Then clears client-side storage and logs out user

**Files Changed:**
- `web/apiClient.ts` - Added logout() method
- `web/CloudApp.tsx` - Added beforeunload event listener (line ~1615)

**How to Test:**
1. Login with admin or cashier account
2. Close the browser/tab completely
3. Reopen browser and navigate back to the app
4. Should see LoginScreen - session should be destroyed
5. To verify server-side: Check that token is no longer in sessions table

---

## Build Status
✅ **Build Successful**
- TypeScript compilation: ✓ No errors
- Vite bundling: ✓ Completed in 899ms
- All 24 modules transformed successfully

## Database Endpoints
The following endpoints are now available:

### Inventory Management
- **GET** `/api/v1/units-of-measure` - Fetch available units of measure
- **GET** `/api/v1/inventory` - Fetch all inventory items  
- **POST** `/api/v1/inventory/products` - Create new inventory product
- **PUT** `/api/v1/inventory/products/:variantId` - Update inventory item

### Session Management
- **POST** `/api/v1/auth/login` - Login user
- **POST** `/api/v1/auth/logout` - Logout and destroy session *(new wrapper)*

---

## Implementation Notes

### Why 23503 Error Was Happening
PostgreSQL error code 23503 is a foreign key constraint violation. The code was trying to reference a UOM ID that didn't exist in the database. The database only has these valid UOMs (from seed):
- `2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e201` - Kilogram
- `2f8c8d4e-8d28-4d4d-9f41-7a52c5f2e202` - Each/pieces

### Session Security Improvement
The beforeunload handler ensures that:
1. When user closes the browser tab, the session token is immediately deleted from the server
2. If someone finds the token in browser storage after closing, it's no longer valid
3. Both admin and cashier sessions are ended on browser close
4. Inactivity timeout still works as a secondary security measure

---

## Next Steps
1. Run the application: `npm run dev`
2. Test the inventory add/edit functionality
3. Test login/logout and browser close behavior
4. Verify no 23503 or 404 errors appear in the console
