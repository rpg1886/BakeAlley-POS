import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import logoUrl from '../../Images/bakeAlley-Logo.jpg';

export interface CheckoutProductPrice {
  tierId: string;
  minQuantity: number;
  pricePerUnit: number;
}

export interface CheckoutProduct {
  variantId: string;
  sku: string;
  name: string;
  unit: string;
  soldByWeight: boolean;
  prices: CheckoutProductPrice[];
  categoryId?: string;
  categoryName?: string;
}

export interface CheckoutCategory {
  categoryId: string;
  name: string;
}

export interface CheckoutCustomer {
  customerId: string;
  displayName: string;
  tierId: string;
}

export interface CheckoutScaleReading {
  grams: number;
  stable: boolean;
}

export interface CheckoutOrderItem {
  variantId: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface CheckoutOrderPayment {
  method: 'cash' | 'card' | 'gcash' | 'account' | 'exchange';
  amount: number;
  cashReceived?: number;
}

export interface CheckoutOrderPayload {
  customerId: string | null;
  pricingTierId: string;
  orderType: 'retail' | 'commercial';
  items: CheckoutOrderItem[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  paymentMethod: 'cash' | 'card' | 'gcash' | 'account' | 'split' | 'exchange';
  cashReceived: number;
  payments: CheckoutOrderPayment[];
  returnedItems?: Array<{ orderItemId: string; variantId: string; lotId?: string; quantity: number; restock: boolean }>;
  orderMode?: 'immediate' | 'reservation';
  fulfillmentDate?: string | null;
  depositAmount?: number;
  balanceDue?: number;
  reservationStatus?: 'unpaid' | 'partially_paid' | 'fully_prepaid' | 'completed' | 'expired' | 'cancelled' | null;
}

export interface CheckoutDataSource {
  searchProducts: (query: string) => Promise<CheckoutProduct[]>;
  createOrderWithOutbox: (order: CheckoutOrderPayload) => Promise<{ orderId: string }>;
  categories?: () => Promise<CheckoutCategory[]>;
}

export interface CheckoutScaleSource {
  read: () => Promise<CheckoutScaleReading | null>;
}

export interface CheckoutScreenProps {
  dataSource: CheckoutDataSource;
  scaleSource?: CheckoutScaleSource;
  scaleEnabled?: boolean;
  customers: CheckoutCustomer[];
  retailTierId: string;
  taxRate?: number;
  employeeToken?: string;
  recordEmployeeSale?: (token: string, orderId: string) => Promise<void>;
  isClockedIn?: boolean;
  exchangeCredit?: number;
  exchangeOriginalOrderId?: string | null;
  onClearExchange?: () => void;
  returnedItems?: Array<{ orderItemId: string; variantId: string; lotId?: string; quantity: number; restock: boolean }>;
}

interface CartLine {
  lineId: string;
  product: CheckoutProduct;
  quantity: number;
  unitPrice: number;
}

// Full 37 Categories extracted from Inventory_Main.csv
const DEFAULT_CATEGORIES = [
  'BAKING PANS',
  'BALL TOPPERS',
  'BUTTER',
  'CAKE ADD ONS',
  'CAKE BOARDS',
  'CAKE BOXES',
  'CAKE EDIBLE TOPPERS',
  'CAKE TOPPERS',
  'CANDLES',
  'CANISTER',
  'CHOCOLATE BAR/CHIPS',
  'CHOCOLATE REPACKED',
  'COCOA',
  'CONFECTIONERY SUGAR',
  'CREAMCHEESE/CHEESE',
  'CUPCAKE /PASTRY BOXES',
  'CUPCAKE LINER',
  'DUMMY',
  'ETC',
  'FLAVORINGS',
  'FLOURS',
  'FLOWERS',
  'FONDANT MOLDERS',
  'FOOD COLOR',
  'HOLDERS/STRAWS/EXTENDER/DOWEL',
  'KITCHEN TOOL/ACCESORIES',
  'MILK/DAIRY',
  'NUTS',
  'OILS',
  'PAPERS/PLASTIC/LINERS',
  'PIPING TIP',
  'RIBBONS',
  'SEASONAL ITEMS',
  'STARCHES',
  'SWEETENERS',
  'TOPPINGS',
  'UNCATEGORIZED',
];

const money = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function resolvePrice(product: CheckoutProduct, tierId: string, quantity: number): number {
  if (!product.prices || product.prices.length === 0) return 0;

  const matchingPrices = product.prices
    .filter((price) => price.tierId === tierId && price.minQuantity <= quantity)
    .sort((left, right) => right.minQuantity - left.minQuantity);

  if (matchingPrices.length > 0 && Number(matchingPrices[0].pricePerUnit) > 0) {
    return Number(matchingPrices[0].pricePerUnit);
  }

  const fallback = product.prices.find((p) => Number(p.pricePerUnit) > 0);
  if (fallback) {
    return Number(fallback.pricePerUnit);
  }

  return 0;
}

function formatWeight(grams: number): string {
  return grams >= 1_000 ? `${(grams / 1_000).toFixed(3)} kg` : `${grams.toFixed(0)} g`;
}

const today = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());

export function CheckoutScreen({
  dataSource,
  scaleSource,
  scaleEnabled = true,
  customers,
  retailTierId,
  taxRate = 0,
  employeeToken,
  recordEmployeeSale,
  isClockedIn = true,
  exchangeCredit = 0,
  exchangeOriginalOrderId = null,
  onClearExchange,
  returnedItems = [],
}: CheckoutScreenProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CheckoutProduct[]>([]);

  const [cart, setCart] = useState<CartLine[]>(() => {
    try {
      const savedCart = localStorage.getItem('bakealley_pos_cart');
      return savedCart ? JSON.parse(savedCart) : [];
    } catch {
      return [];
    }
  });

  const [customerId, setCustomerId] = useState<string | null>(() => {
    return localStorage.getItem('bakealley_pos_customer_id') || null;
  });

  const [categoriesList, setCategoriesList] = useState<CheckoutCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<{ categoryId?: string; name: string } | null>(null);
  const [categoryProducts, setCategoryProducts] = useState<CheckoutProduct[]>([]);
  const [categoryLoading, setCategoryLoading] = useState(false);

  const [scaleReading, setScaleReading] = useState<CheckoutScaleReading | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [orderModeModalOpen, setOrderModeModalOpen] = useState(false);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<CheckoutOrderPayment['method']>('cash');
  const [splitPayments, setSplitPayments] = useState<CheckoutOrderPayment[]>([]);
  const [cashReceived, setCashReceived] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // Advance Order / Reservation States
  const [orderMode, setOrderMode] = useState<'immediate' | 'reservation'>('immediate');
  const [fulfillmentDate, setFulfillmentDate] = useState<string>(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().slice(0, 10);
  });
  const [depositPreset, setDepositPreset] = useState<'zero' | '50' | '100' | 'custom'>('zero');
  const [customDeposit, setCustomDeposit] = useState<string>('');

  const subtotal = cart.reduce((total, line) => total + line.quantity * line.unitPrice, 0);
  const taxAmount = subtotal * taxRate;
  const totalAmount = subtotal + taxAmount;

  const calculatedDeposit =
    orderMode === 'reservation'
      ? depositPreset === 'zero'
        ? 0
        : depositPreset === '50'
          ? Number((totalAmount * 0.5).toFixed(2))
          : depositPreset === '100'
            ? Number(totalAmount.toFixed(2))
            : Math.min(totalAmount, Math.max(0, Number(customDeposit) || 0))
      : 0;

  const calculatedBalanceDue =
    orderMode === 'reservation' ? Math.max(0, Number((totalAmount - calculatedDeposit).toFixed(2))) : 0;

  const targetPaymentTotal = orderMode === 'reservation' && calculatedDeposit > 0 ? calculatedDeposit : totalAmount;

  const searchInputRef = useRef<HTMLInputElement>(null);
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const customerDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (customerDropdownRef.current && !customerDropdownRef.current.contains(event.target as Node)) {
        setCustomerDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('bakealley_pos_cart', JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    if (customerId) {
      localStorage.setItem('bakealley_pos_customer_id', customerId);
    } else {
      localStorage.removeItem('bakealley_pos_customer_id');
    }
  }, [customerId]);

  useEffect(() => {
    if (dataSource.categories) {
      dataSource
        .categories()
        .then((cats) => {
          if (Array.isArray(cats) && cats.length > 0) {
            setCategoriesList(cats);
          }
        })
        .catch(() => undefined);
    }
  }, [dataSource]);

  const selectedCustomer = customers.find((customer) => customer.customerId === customerId) ?? null;
  const isWholesaleCustomer = Boolean(selectedCustomer && selectedCustomer.tierId !== retailTierId);
  const pricingTierId = selectedCustomer?.tierId ?? retailTierId;

  const filteredCustomers = customers.filter((customer) => {
    const term = customerSearchTerm.toLowerCase().trim();
    if (!term) return true;
    return customer.displayName.toLowerCase().includes(term);
  });

  const totalPaidSoFar = splitPayments.reduce((sum, p) => sum + p.amount, 0);
  const effectiveExchangeCredit = exchangeCredit || 0;
  const appliedExchangeCredit = Math.min(targetPaymentTotal, effectiveExchangeCredit);
  const remainingBalance = Math.max(0, Number((targetPaymentTotal - appliedExchangeCredit - totalPaidSoFar).toFixed(2)));
  const cashTendered = Number(cashReceived);
  const changeDue = paymentMethod === 'cash' && Number.isFinite(cashTendered) ? cashTendered - remainingBalance : 0;
  const activeWeightLine = scaleEnabled ? cart.find((line) => line.product.soldByWeight) : undefined;

  const orderItems = cart.map((line) => ({
    variantId: line.product.variantId,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    totalPrice: line.quantity * line.unitPrice,
  }));

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!scaleSource || !activeWeightLine) {
      setScaleReading(null);
      return undefined;
    }

    let mounted = true;
    const poll = async (): Promise<void> => {
      try {
        const reading = await scaleSource.read();
        if (mounted) {
          setScaleReading(reading);
        }
      } catch {
        if (mounted) {
          setScaleReading(null);
        }
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 500);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [activeWeightLine?.lineId, scaleSource]);

  useEffect(() => {
    setCart((currentCart) =>
      currentCart.map((line) => ({
        ...line,
        unitPrice: resolvePrice(line.product, pricingTierId, line.quantity),
      }))
    );
  }, [pricingTierId]);

  useEffect(() => {
    if (!activeWeightLine || !scaleReading) {
      return;
    }
    const quantity = scaleReading.grams / (activeWeightLine.product.unit.toLowerCase() === 'kg' ? 1_000 : 1);
    if (quantity <= 0) {
      return;
    }
    setCart((currentCart) =>
      currentCart.map((line) =>
        line.lineId === activeWeightLine.lineId
          ? { ...line, quantity, unitPrice: resolvePrice(line.product, pricingTierId, quantity) }
          : line
      )
    );
  }, [activeWeightLine?.lineId, activeWeightLine?.product.unit, pricingTierId, scaleReading?.grams]);

  const search = async (searchQuery: string): Promise<void> => {
    setQuery(searchQuery);
    if (searchQuery.trim().length < 1) {
      setResults([]);
      return;
    }
    setResults(await dataSource.searchProducts(searchQuery.trim()));
  };

  const handleSelectCategory = async (categoryName: string, categoryId?: string): Promise<void> => {
    setSelectedCategory({ categoryId, name: categoryName });
    setCategoryLoading(true);
    try {
      const searchParam = categoryId
        ? `?categoryId=${encodeURIComponent(categoryId)}`
        : `?category=${encodeURIComponent(categoryName)}`;
      const items = await dataSource.searchProducts(searchParam);
      setCategoryProducts(items);
    } catch {
      setCategoryProducts([]);
    } finally {
      setCategoryLoading(false);
    }
  };

  const addProduct = (product: CheckoutProduct): void => {
    setMessage(null);
    setResults([]);
    setQuery('');
    setCart((currentCart) => {
      const existing = currentCart.find((line) => line.product.variantId === product.variantId);
      if (existing && !product.soldByWeight) {
        const quantity = existing.quantity + 1;
        return currentCart.map((line) =>
          line.lineId === existing.lineId
            ? { ...line, quantity, unitPrice: resolvePrice(product, pricingTierId, quantity) }
            : line
        );
      }

      const quantity = product.soldByWeight
        ? (scaleReading?.grams ?? 0) / (product.unit.toLowerCase() === 'kg' ? 1_000 : 1)
        : 1;
      return [
        ...currentCart,
        {
          lineId: crypto.randomUUID(),
          product,
          quantity,
          unitPrice: resolvePrice(product, pricingTierId, quantity),
        },
      ];
    });
  };

  const updateQuantity = (lineId: string, quantity: number): void => {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return;
    }
    setCart((currentCart) =>
      currentCart.map((line) =>
        line.lineId === lineId
          ? { ...line, quantity, unitPrice: resolvePrice(line.product, pricingTierId, quantity) }
          : line
      )
    );
  };

  const submitZeroDepositReservation = async (): Promise<void> => {
    if (orderItems.length === 0 || orderItems.some((item) => item.quantity <= 0)) {
      setMessage('Add valid items to cart before creating a reservation.');
      return;
    }
    if (!customerId) {
      setMessage('A customer profile is required for reservations. Please select or add a customer in the top-right menu.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await dataSource.createOrderWithOutbox({
        customerId,
        pricingTierId,
        orderType: isWholesaleCustomer ? 'commercial' : 'retail',
        items: orderItems,
        subtotal: Number(subtotal.toFixed(2)),
        taxAmount: Number(taxAmount.toFixed(2)),
        totalAmount: Number(totalAmount.toFixed(2)),
        paymentMethod: 'cash',
        cashReceived: 0,
        payments: [],
        orderMode: 'reservation',
        fulfillmentDate,
        depositAmount: 0,
        balanceDue: Number(totalAmount.toFixed(2)),
        reservationStatus: 'unpaid',
      });

      setCart([]);
      setCustomerId(null);
      localStorage.removeItem('bakealley_pos_cart');
      localStorage.removeItem('bakealley_pos_customer_id');

      setMessage(`Advance Order Reservation created successfully for ${fulfillmentDate}! Balance Due on pickup: ${money.format(totalAmount)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Reservation creation failed.');
    } finally {
      setBusy(false);
    }
  };

  const submitOrder = async (): Promise<void> => {
    if (orderItems.length === 0 || orderItems.some((item) => item.quantity <= 0)) {
      setMessage('Add a valid quantity before taking payment.');
      return;
    }
    const currentTendered = Number(cashReceived) || remainingBalance;

    if (remainingBalance > 0 && paymentMethod === 'cash' && (!Number.isFinite(cashTendered) || cashTendered <= 0)) {
      setMessage('Enter a valid cash amount.');
      return;
    }

    const allocatedAmount =
      remainingBalance > 0
        ? paymentMethod === 'cash'
          ? Math.min(cashTendered, remainingBalance)
          : Math.min(currentTendered, remainingBalance)
        : 0;

    const currentPayment: CheckoutOrderPayment = {
      method: paymentMethod,
      amount: allocatedAmount,
      cashReceived: paymentMethod === 'cash' ? cashTendered : undefined,
    };

    if (remainingBalance > 0 && allocatedAmount < remainingBalance) {
      const updatedSplit = [...splitPayments, currentPayment];
      const newPaid = updatedSplit.reduce((sum, p) => sum + p.amount, 0);
      const newRemaining = Math.max(0, Number((targetPaymentTotal - appliedExchangeCredit - newPaid).toFixed(2)));
      setSplitPayments(updatedSplit);
      setCashReceived(newRemaining.toFixed(2));
      setMessage(`Partial payment of ${money.format(allocatedAmount)} (${paymentMethod.toUpperCase()}) recorded. ${money.format(newRemaining)} remaining.`);
      return;
    }

    const rawPayments: CheckoutOrderPayment[] = [];
    if (appliedExchangeCredit > 0) {
      rawPayments.push({ method: 'exchange', amount: appliedExchangeCredit });
    }
    rawPayments.push(...splitPayments);
    if (allocatedAmount > 0) {
      rawPayments.push(currentPayment);
    }

    const finalPayments = rawPayments.length > 0 ? rawPayments : [currentPayment];
    const finalMethod = finalPayments.length > 1 ? 'split' : finalPayments[0].method;
    const totalCashTendered = finalPayments
      .filter((p) => p.method === 'cash')
      .reduce((sum, p) => sum + (p.cashReceived ?? p.amount), 0);

    setBusy(true);
    setMessage(null);
    setPaymentError(null);
    try {
      const result = await dataSource.createOrderWithOutbox({
        customerId,
        pricingTierId,
        orderType: isWholesaleCustomer ? 'commercial' : 'retail',
        items: orderItems,
        subtotal: Number(subtotal.toFixed(2)),
        taxAmount: Number(taxAmount.toFixed(2)),
        totalAmount: Number(totalAmount.toFixed(2)),
        paymentMethod: finalMethod,
        cashReceived: Number(totalCashTendered.toFixed(2)),
        payments: finalPayments,
        returnedItems: returnedItems.length > 0 ? returnedItems : undefined,
        orderMode,
        fulfillmentDate: orderMode === 'reservation' ? fulfillmentDate : null,
        depositAmount: calculatedDeposit,
        balanceDue: calculatedBalanceDue,
        reservationStatus:
          orderMode === 'reservation'
            ? calculatedBalanceDue <= 0
              ? 'fully_prepaid'
              : calculatedDeposit > 0
                ? 'partially_paid'
                : 'unpaid'
            : null,
      });

      if (employeeToken && recordEmployeeSale) {
        await recordEmployeeSale(employeeToken, result.orderId);
      }

      const cashPayments = finalPayments.filter((p) => p.method === 'cash');
      let finalChangeDue = 0;
      if (cashPayments.length > 0) {
        const totalCashNeeded = cashPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
        const totalCashTenderedInSplit = cashPayments.reduce((sum, p) => sum + Number(p.cashReceived || p.amount || 0), 0);
        finalChangeDue = Math.max(0, Number((totalCashTenderedInSplit - totalCashNeeded).toFixed(2)));
      }

      setCart([]);
      setCustomerId(null);
      localStorage.removeItem('bakealley_pos_cart');
      localStorage.removeItem('bakealley_pos_customer_id');

      setCashReceived('');
      setSplitPayments([]);
      setPaymentOpen(false);

      if (onClearExchange) {
        onClearExchange();
      }

      if (orderMode === 'reservation') {
        setMessage(`Advance Order Reservation created successfully for ${fulfillmentDate}! Deposit paid: ${money.format(calculatedDeposit)}, Balance Due on pickup: ${money.format(calculatedBalanceDue)}${finalChangeDue > 0 ? ` (Change: ${money.format(finalChangeDue)})` : ''}`);
      } else if (appliedExchangeCredit > 0) {
        if (finalChangeDue > 0) {
          setMessage(`Exchange completed successfully! Change due to customer: ${money.format(finalChangeDue)}`);
        } else {
          setMessage('Exchange completed successfully!');
        }
      } else {
        if (finalChangeDue > 0) {
          setMessage(`Order completed successfully! Change due to customer: ${money.format(finalChangeDue)}`);
        } else {
          setMessage('Order completed successfully!');
        }
      }
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : 'Order submission failed.');
    } finally {
      setBusy(false);
    }
  };

  const paymentOptions = [
    { id: 'cash', label: 'Cash', icon: '💵', color: 'border-emerald-500 bg-emerald-50 text-emerald-800' },
    { id: 'card', label: 'Card / POS', icon: '💳', color: 'border-blue-500 bg-blue-50 text-blue-800' },
    { id: 'gcash', label: 'GCash', icon: '📱', color: 'border-sky-500 bg-sky-50 text-sky-800' },
    { id: 'account', label: 'Account', icon: '📋', color: 'border-amber-500 bg-amber-50 text-amber-800' },
  ] as const;

  return (
    <main className="min-h-screen bg-[#FAF6F0] p-4 text-amber-950 font-sans">
      <div className="mx-auto max-w-[1600px] space-y-4">
        {/* Top Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-amber-200/80 bg-white px-5 py-3 rounded-xl shadow-sm">
          <div className="flex items-center gap-3">
            <img alt="Bake Alley logo" className="h-9 w-9 rounded-full border border-amber-200 object-cover shadow-sm" src={logoUrl} />
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-amber-600">Bake Alley POS</p>
              <h1 className="font-bakery text-2xl font-bold tracking-tight text-amber-950">Checkout</h1>
            </div>
          </div>

          {/* Active Customer Profile Badge */}
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3.5 py-2 text-xs shadow-sm">
            <span className="font-bold text-amber-700">Active Profile:</span>
            <span className="font-extrabold text-amber-950">
              {!selectedCustomer
                ? "👤 Retail Walk-in"
                : isWholesaleCustomer
                  ? "🏢 " + selectedCustomer.displayName + " (Wholesale)"
                  : "🔁 " + selectedCustomer.displayName + " (Return Client)"}
            </span>
            <button
              type="button"
              onClick={() => setCustomerModalOpen(true)}
              className="ml-2 rounded-md bg-amber-200/80 px-2 py-0.5 text-[10px] font-bold text-amber-900 hover:bg-amber-300 transition"
            >
              Change ✎
            </button>
          </div>
        </header>

        {/* Global Notifications */}
        {message && (
          <div className="rounded-xl bg-amber-900 px-4 py-3 text-xs text-white shadow-md flex justify-between items-center" role="status">
            <span>{message}</span>
            <button type="button" className="font-bold text-amber-200" onClick={() => setMessage(null)}>✕</button>
          </div>
        )}

        {/* MAIN POS 2-COLUMN LAYOUT */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
          {/* LEFT COLUMN: Quick Action Bar, Cart Table & Payment Bar (~38% width = 5 cols) */}
          <div className="col-span-12 md:col-span-5 space-y-4">
            {/* Horizontal Action Tab Bar (Customer, Order Mode, Clear) */}
            <div className="grid grid-cols-3 gap-2 bg-white p-2 rounded-xl border border-amber-200/80 shadow-sm">
              <button
                type="button"
                onClick={() => setCustomerModalOpen(true)}
                className={`rounded-lg py-2 text-xs font-bold transition flex items-center justify-center gap-1.5 ${selectedCustomer
                    ? 'bg-emerald-700 text-white shadow-sm'
                    : 'bg-amber-100/70 text-amber-900 hover:bg-amber-200'
                  }`}
              >
                <span>👤</span>
                <span className="truncate">{selectedCustomer ? selectedCustomer.displayName : 'Customer'}</span>
              </button>

              <button
                type="button"
                onClick={() => setOrderModeModalOpen(true)}
                className={`rounded-lg py-2 text-xs font-bold transition flex items-center justify-center gap-1.5 ${orderMode === 'reservation'
                    ? 'bg-amber-800 text-white shadow-sm'
                    : 'bg-amber-100/70 text-amber-900 hover:bg-amber-200'
                  }`}
              >
                <span>⚙️</span>
                <span>{orderMode === 'reservation' ? '📅 Advance' : 'Order Mode'}</span>
              </button>

              <button
                type="button"
                onClick={() => setCart([])}
                disabled={cart.length === 0}
                className="rounded-lg bg-red-50 py-2 text-xs font-bold text-red-700 hover:bg-red-100 transition disabled:opacity-40 flex items-center justify-center gap-1.5"
              >
                <span>🗑️</span>
                <span>Clear</span>
              </button>
            </div>

            {/* Cart Table Container */}
            <div className="rounded-xl border border-amber-200/80 bg-white shadow-sm overflow-hidden flex flex-col min-h-[420px] justify-between">
              <div className="border-b border-amber-100 px-4 py-3 bg-amber-50/40 flex justify-between items-center">
                <h2 className="font-bold text-xs uppercase tracking-wider text-amber-900">Current Transaction</h2>
                <span className="text-[11px] font-bold text-amber-700">{cart.length} item(s)</span>
              </div>

              <div className="flex-1 overflow-y-auto">
                {cart.length === 0 ? (
                  <div className="flex h-64 items-center justify-center text-center p-6">
                    <p className="text-sm font-semibold text-slate-400">No Records</p>
                  </div>
                ) : (
                  <table className="w-full text-left text-xs">
                    <thead className="bg-amber-50/80 text-[11px] font-semibold text-amber-800 uppercase border-b border-amber-100">
                      <tr>
                        <th className="p-2.5">Item</th>
                        <th className="p-2.5 text-center">Qty</th>
                        <th className="p-2.5 text-right">Price</th>
                        <th className="p-2.5 text-right">Total</th>
                        <th className="p-2 text-center">✕</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-amber-100">
                      {cart.map((line) => (
                        <tr key={line.lineId} className="hover:bg-amber-50/30 transition">
                          <td className="p-2.5 font-bold text-amber-950">
                            <div>{line.product.name}</div>
                            <div className="text-[10px] font-mono text-amber-700">{line.product.sku}</div>
                          </td>
                          <td className="p-2.5 text-center">
                            <input
                              type="number"
                              min="0.0001"
                              step="0.0001"
                              className="w-16 rounded border border-amber-300 p-1 text-center font-bold text-xs text-amber-950 outline-none"
                              value={line.quantity}
                              onChange={(e) => updateQuantity(line.lineId, Number(e.target.value))}
                            />
                          </td>
                          <td className="p-2.5 text-right font-medium tabular-nums">{money.format(line.unitPrice)}</td>
                          <td className="p-2.5 text-right font-bold tabular-nums text-amber-950">{money.format(line.quantity * line.unitPrice)}</td>
                          <td className="p-2 text-center">
                            <button
                              type="button"
                              className="text-red-600 hover:text-red-800 font-bold px-1"
                              onClick={() => setCart((c) => c.filter((i) => i.lineId !== line.lineId))}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Bottom Sticky Total & Checkout Action */}
              <div className="border-t border-amber-200 bg-amber-50/60 p-4 space-y-3">
                {effectiveExchangeCredit > 0 && (
                  <div className="flex justify-between items-center text-xs bg-amber-100 p-2 rounded-lg border border-amber-300">
                    <span className="font-bold text-amber-900">🔄 Return Credit:</span>
                    <strong className="text-emerald-800 font-bold">{money.format(effectiveExchangeCredit)}</strong>
                  </div>
                )}

                <div className="flex justify-between items-center text-xs font-semibold text-amber-900">
                  <span>Order Mode:</span>
                  <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${orderMode === 'reservation' ? 'bg-amber-800 text-white' : 'bg-emerald-100 text-emerald-800'}`}>
                    {orderMode === 'reservation' ? `📅 Advance Order (${fulfillmentDate})` : '🛒 Immediate Sale'}
                  </span>
                </div>

                <div className="flex justify-between items-center text-xl font-extrabold text-amber-950 border-t border-amber-200 pt-2">
                  <span>Total Amount:</span>
                  <span className="tabular-nums">{money.format(totalAmount)}</span>
                </div>

                {orderMode === 'reservation' && calculatedDeposit === 0 ? (
                  <button
                    type="button"
                    disabled={cart.length === 0 || busy || isClockedIn === false}
                    onClick={() => void submitZeroDepositReservation()}
                    className="w-full rounded-xl bg-amber-800 py-3.5 text-sm font-bold text-white shadow-md hover:bg-amber-900 disabled:opacity-50 transition"
                  >
                    {isClockedIn === false ? 'Clock-in Required' : `📅 Create Reservation (${money.format(totalAmount)} Unpaid)`}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={cart.length === 0 || busy || isClockedIn === false}
                    onClick={() => setPaymentOpen(true)}
                    className="w-full rounded-xl bg-amber-700 py-3.5 text-sm font-bold text-white shadow-md hover:bg-amber-800 disabled:opacity-50 transition"
                  >
                    {isClockedIn === false
                      ? 'Clock-in Required to Take Payment'
                      : orderMode === 'reservation'
                        ? `📅 Collect Deposit & Reserve (${money.format(calculatedDeposit)})`
                        : `💳 PAYMENT / TAKE PAYMENT (${money.format(totalAmount)})`}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Search Input & 37-Category / Item Catalog Grid (~62% width = 7 cols) */}
          <div className="col-span-12 md:col-span-7 space-y-4">
            {/* Top Barcode & SKU Search Bar */}
            <div className="relative">
              <input
                ref={searchInputRef}
                type="text"
                autoComplete="off"
                placeholder="Input barcode or search SKU..."
                value={query}
                onChange={(e) => void search(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && results.length > 0) {
                    addProduct(results[0]);
                  }
                }}
                className="w-full rounded-xl border border-amber-300 bg-white px-4 py-3 text-sm font-bold shadow-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/40"
              />
              {results.length > 0 && (
                <div className="absolute z-30 mt-1 grid w-full gap-2 rounded-xl border border-amber-200 bg-white p-2 shadow-2xl sm:grid-cols-2">
                  {results.slice(0, 8).map((product) => (
                    <button
                      key={product.variantId}
                      type="button"
                      onClick={() => addProduct(product)}
                      className="flex flex-col items-start gap-1 rounded-xl border border-amber-200 bg-amber-50/30 p-2.5 text-left hover:bg-amber-100/60"
                    >
                      <strong className="text-xs text-amber-950">{product.name}</strong>
                      <div className="flex justify-between w-full text-[10px] text-amber-700">
                        <span>{product.sku}</span>
                        <span className="font-bold text-amber-900">{money.format(resolvePrice(product, pricingTierId, 1))}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Catalog Grid Area (37 Categories or Category Items Cover View) */}
            <div className="rounded-xl border border-amber-200/80 bg-white p-4 shadow-sm min-h-[500px]">
              <div className="mb-3 flex items-center justify-between border-b border-amber-100 pb-2">
                <h2 className="font-bakery text-sm font-bold text-amber-950 uppercase tracking-wide">
                  {selectedCategory ? `Category: ${selectedCategory.name}` : 'Product Categories (37)'}
                </h2>
                {selectedCategory && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCategory(null);
                      setCategoryProducts([]);
                    }}
                    className="rounded-lg bg-amber-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-900 shadow-sm"
                  >
                    ← Back to Categories
                  </button>
                )}
              </div>

              {!selectedCategory ? (
                /* 37 CATEGORY TILE GRID */
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
                  {DEFAULT_CATEGORIES.map((catName) => (
                    <button
                      key={catName}
                      type="button"
                      onClick={() => void handleSelectCategory(catName)}
                      className="flex h-20 flex-col items-center justify-center rounded-xl border border-amber-200 bg-amber-50/50 p-2 text-center transition hover:-translate-y-0.5 hover:border-amber-500 hover:bg-amber-100/80 hover:shadow-md"
                    >
                      <span className="font-bold text-xs text-amber-950 uppercase line-clamp-2">{catName}</span>
                    </button>
                  ))}
                </div>
              ) : (
                /* CATEGORY ITEM COVER VIEW */
                <div>
                  {categoryLoading ? (
                    <p className="py-16 text-center text-xs font-semibold text-amber-700">Loading products for {selectedCategory.name}...</p>
                  ) : categoryProducts.length === 0 ? (
                    <div className="py-16 text-center">
                      <p className="text-xs font-semibold text-amber-700">No items found under {selectedCategory.name}.</p>
                      <button
                        type="button"
                        className="mt-3 rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-900"
                        onClick={() => setSelectedCategory(null)}
                      >
                        Return to Category List
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                      {categoryProducts.map((product) => {
                        const unitPrice = resolvePrice(product, pricingTierId, 1);
                        return (
                          <button
                            key={product.variantId}
                            type="button"
                            onClick={() => addProduct(product)}
                            className="flex flex-col justify-between rounded-xl border border-amber-200 bg-white p-3 text-left shadow-sm transition hover:border-amber-500 hover:shadow-md hover:bg-amber-50/30"
                          >
                            <div>
                              <h3 className="font-bold text-xs text-amber-950 line-clamp-2">{product.name}</h3>
                              <p className="mt-1 font-mono text-[10px] text-amber-700">{product.sku}</p>
                            </div>
                            <div className="mt-3 flex items-center justify-between border-t border-amber-100 pt-2">
                              <span className="font-bold text-xs text-amber-900 tabular-nums">{money.format(unitPrice)}</span>
                              <span className="rounded-md bg-amber-700 px-2 py-0.5 text-[10px] font-bold text-white">+ Add</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* CUSTOMER PROFILE SELECTION MODAL WINDOW */}
      {customerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-amber-950/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between border-b border-amber-100 pb-3">
              <div>
                <h3 className="font-bakery text-lg font-bold text-amber-950">👤 Select Customer Profile</h3>
                <p className="text-xs text-amber-700 mt-0.5">Search customer accounts to apply wholesale tiers or return history.</p>
              </div>
              <button
                type="button"
                className="text-xl font-bold text-amber-700 hover:text-amber-950"
                onClick={() => setCustomerModalOpen(false)}
              >
                ✕
              </button>
            </div>

            {/* Customer Search Input */}
            <div>
              <label className="block text-xs font-bold text-amber-950 mb-1">Search Customer Name / Company</label>
              <input
                type="text"
                autoFocus
                placeholder="Type customer name..."
                value={customerSearchTerm}
                onChange={(e) => setCustomerSearchTerm(e.target.value)}
                className="w-full rounded-xl border border-amber-300 px-3.5 py-2.5 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30"
              />
            </div>

            {/* Customer Profiles List */}
            <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
              <button
                type="button"
                onClick={() => {
                  setCustomerId(null);
                  setCustomerSearchTerm('');
                  setCustomerModalOpen(false);
                }}
                className={`w-full text-left rounded-xl p-3 text-xs font-bold transition border ${!selectedCustomer
                    ? 'bg-amber-800 text-white border-amber-800 shadow-sm'
                    : 'bg-amber-50/50 border-amber-200 text-amber-900 hover:bg-amber-100'
                  }`}
              >
                <div className="flex items-center justify-between">
                  <span>👤 Retail Walk-in (Standard Retail Pricing)</span>
                  {!selectedCustomer && <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded">Active</span>}
                </div>
              </button>

              {filteredCustomers.length === 0 ? (
                <p className="py-6 text-center text-xs text-amber-600 font-semibold">No matching customer profiles found.</p>
              ) : (
                filteredCustomers.map((customer) => {
                  const isSelected = customer.customerId === customerId;
                  const isWholesale = customer.tierId !== retailTierId;
                  return (
                    <button
                      key={customer.customerId}
                      type="button"
                      onClick={() => {
                        setCustomerId(customer.customerId);
                        setCustomerSearchTerm('');
                        setCustomerModalOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-xl p-3 text-xs transition border ${isSelected
                          ? 'bg-emerald-800 text-white border-emerald-800 shadow-sm font-bold'
                          : 'bg-white border-amber-200 text-amber-900 hover:bg-amber-50'
                        }`}
                    >
                      <div className="flex items-center gap-2">
                        <span>{isWholesale ? "🏢" : "🔁"}</span>
                        <span className="font-bold">{customer.displayName}</span>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${isSelected
                            ? 'bg-white/20 text-white'
                            : isWholesale
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                      >
                        {isWholesale ? 'Wholesale Tier' : 'Return Client'}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-amber-100">
              <button
                type="button"
                className="w-full rounded-xl bg-amber-800 py-2.5 text-xs font-bold text-white hover:bg-amber-900"
                onClick={() => setCustomerModalOpen(false)}
              >
                Apply & Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ORDER MODE SELECTION MODAL (Immediate vs Advance Order) */}
      {orderModeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-amber-950/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between border-b border-amber-100 pb-3">
              <div>
                <h3 className="font-bakery text-lg font-bold text-amber-950">⚙️ Select Checkout Order Mode</h3>
                <p className="text-xs text-amber-700 mt-0.5">Choose order processing behavior for this transaction.</p>
              </div>
              <button type="button" className="text-xl font-bold text-amber-700" onClick={() => setOrderModeModalOpen(false)}>✕</button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setOrderMode('immediate')}
                className={`rounded-xl border p-3 text-left transition ${orderMode === 'immediate' ? 'bg-amber-800 text-white border-amber-800 shadow-sm font-bold' : 'bg-white border-amber-200 text-amber-900 hover:bg-amber-50'
                  }`}
              >
                <div className="text-sm">🛒 Immediate Sale</div>
                <div className="text-[10px] opacity-80 mt-1">Standard counter transaction with immediate stock deduction.</div>
              </button>
              <button
                type="button"
                onClick={() => setOrderMode('reservation')}
                className={`rounded-xl border p-3 text-left transition ${orderMode === 'reservation' ? 'bg-amber-800 text-white border-amber-800 shadow-sm font-bold' : 'bg-white border-amber-200 text-amber-900 hover:bg-amber-50'
                  }`}
              >
                <div className="text-sm">📅 Advance Order</div>
                <div className="text-[10px] opacity-80 mt-1">Scheduled pickup/fulfillment date with flexible downpayment.</div>
              </button>
            </div>

            {orderMode === 'reservation' && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 space-y-3 text-xs">
                <div>
                  <label className="block font-bold text-amber-950 mb-1">📅 Pickup / Fulfillment Date *</label>
                  <input
                    type="date"
                    min={today()}
                    className="w-full rounded-lg border border-amber-300 p-2 font-medium text-amber-950 outline-none focus:ring-2 focus:ring-amber-500"
                    value={fulfillmentDate}
                    onChange={(e) => setFulfillmentDate(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block font-bold text-amber-950 mb-1">💰 Deposit Choice</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setDepositPreset('zero')}
                      className={`rounded-lg border p-1.5 text-center font-bold transition ${depositPreset === 'zero' ? 'bg-amber-800 text-white border-amber-800' : 'bg-white border-amber-200 text-amber-900 hover:bg-amber-100'
                        }`}
                    >
                      ₱0 Upfront
                    </button>
                    <button
                      type="button"
                      onClick={() => setDepositPreset('50')}
                      className={`rounded-lg border p-1.5 text-center font-bold transition ${depositPreset === '50' ? 'bg-amber-800 text-white border-amber-800' : 'bg-white border-amber-200 text-amber-900 hover:bg-amber-100'
                        }`}
                    >
                      50% Deposit
                    </button>
                    <button
                      type="button"
                      onClick={() => setDepositPreset('100')}
                      className={`rounded-lg border p-1.5 text-center font-bold transition ${depositPreset === '100' ? 'bg-amber-800 text-white border-amber-800' : 'bg-white border-amber-200 text-amber-900 hover:bg-amber-100'
                        }`}
                    >
                      100% Prepaid
                    </button>
                    <button
                      type="button"
                      onClick={() => setDepositPreset('custom')}
                      className={`rounded-lg border p-1.5 text-center font-bold transition ${depositPreset === 'custom' ? 'bg-amber-800 text-white border-amber-800' : 'bg-white border-amber-200 text-amber-900 hover:bg-amber-100'
                        }`}
                    >
                      Custom ₱
                    </button>
                  </div>
                </div>

                {depositPreset === 'custom' && (
                  <div>
                    <label className="block font-semibold text-amber-900 mb-1">Custom Deposit Amount (₱)</label>
                    <input
                      type="number"
                      min="0"
                      max={totalAmount}
                      step="0.01"
                      className="w-full rounded-lg border border-amber-300 p-2 font-bold text-amber-950 outline-none"
                      value={customDeposit}
                      placeholder="Enter deposit..."
                      onChange={(e) => setCustomDeposit(e.target.value)}
                    />
                  </div>
                )}

                <div className="border-t border-amber-200 pt-2 space-y-1 font-semibold text-amber-950">
                  <div className="flex justify-between">
                    <span>Deposit Required Today:</span>
                    <strong className="text-emerald-800">{money.format(calculatedDeposit)}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Balance Due at Pickup:</span>
                    <strong className="text-amber-900">{money.format(calculatedBalanceDue)}</strong>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-amber-100">
              <button
                type="button"
                className="w-full rounded-xl bg-amber-800 py-2.5 text-xs font-bold text-white hover:bg-amber-900"
                onClick={() => setOrderModeModalOpen(false)}
              >
                Apply & Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PAYMENT SETTLEMENT MODAL */}
      {paymentOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-amber-950/50 p-4" role="presentation">
          <section aria-labelledby="payment-title" aria-modal="true" className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl space-y-4" role="dialog">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-amber-600">
                  {appliedExchangeCredit > 0 ? 'Exchange Payment & Settlement' : orderMode === 'reservation' ? 'Advance Order Deposit Settlement' : 'Payment'}
                </p>
                <h2 className="font-bakery mt-1 text-2xl font-bold tabular-nums" id="payment-title">
                  {money.format(targetPaymentTotal)}
                </h2>
                {appliedExchangeCredit > 0 && (
                  <div className="mt-1 space-y-0.5 text-xs font-semibold">
                    <p className="text-emerald-700">
                      🔄 Applied Return Credit: <span className="tabular-nums">{money.format(appliedExchangeCredit)}</span>
                    </p>
                    <p className="text-amber-900">
                      Net Balance Due: <span className="tabular-nums">{money.format(remainingBalance)}</span>
                    </p>
                  </div>
                )}
                {splitPayments.length > 0 && (
                  <p className="text-xs font-semibold text-amber-800 mt-1">
                    Remaining Needed: <span>{money.format(remainingBalance)}</span>
                  </p>
                )}
              </div>
              <button
                aria-label="Close payment dialog"
                className="text-2xl text-amber-600 hover:text-amber-900"
                type="button"
                onClick={() => {
                  setPaymentOpen(false);
                  setSplitPayments([]);
                }}
              >
                ×
              </button>
            </div>

            {splitPayments.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 space-y-1.5 text-xs text-amber-950">
                <p className="font-bold text-amber-900">Recorded Partial Payments:</p>
                {splitPayments.map((p, idx) => (
                  <div key={idx} className="flex items-center justify-between bg-white/90 rounded-lg px-2.5 py-1.5 border border-amber-200/60 font-medium">
                    <span className="uppercase tracking-wider font-bold text-amber-800">{p.method}</span>
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums font-bold">{money.format(p.amount)}</span>
                      <button
                        type="button"
                        className="text-red-600 hover:text-red-800 font-bold text-sm px-1"
                        title="Remove partial payment"
                        onClick={() => {
                          const updated = splitPayments.filter((_, i) => i !== idx);
                          setSplitPayments(updated);
                          const newRemaining = targetPaymentTotal - appliedExchangeCredit - updated.reduce((s, x) => s + x.amount, 0);
                          setCashReceived(newRemaining.toFixed(2));
                        }}
                      >
                        x
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {remainingBalance === 0 && appliedExchangeCredit > 0 ? (
              <div className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-center text-xs font-medium text-emerald-950">
                <p className="text-base font-bold text-emerald-800">🔄 100% Covered by Return Credit</p>
                <p className="mt-1 text-emerald-900">
                  The applied return credit of <strong>{money.format(appliedExchangeCredit)}</strong> fully covers this purchase. No additional cash or card payment is required.
                </p>
              </div>
            ) : (
              <fieldset className="mt-2">
                <legend className="text-sm font-semibold mb-3">Select Payment Method</legend>
                <div className="grid grid-cols-2 gap-2.5">
                  {paymentOptions.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setPaymentMethod(opt.id);
                        setCashReceived(remainingBalance > 0 ? remainingBalance.toFixed(2) : '');
                      }}
                      className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition ${paymentMethod === opt.id
                        ? `${opt.color} ring-2 ring-amber-500/50 shadow-sm font-bold`
                        : 'border-amber-200/80 text-amber-900 hover:bg-amber-50/50 font-semibold'
                        }`}
                    >
                      <span className="text-xl">{opt.icon}</span>
                      <span className="text-sm">{opt.label}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            {paymentMethod === 'cash' && (
              <div className="mt-3">
                <label className="text-sm font-semibold">
                  Cash received
                  <input
                    autoFocus
                    className="mt-2 w-full rounded-lg border border-amber-200/80 px-3 py-3 text-lg outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/40"
                    min="0.01"
                    step="0.01"
                    type="number"
                    value={cashReceived}
                    onChange={(event) => setCashReceived(event.target.value)}
                  />
                </label>
                <div className={`mt-3 flex justify-between rounded-lg px-3 py-3 text-sm font-semibold ${changeDue >= 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
                  <span>{changeDue >= 0 ? 'Change due' : 'Still needed'}</span>
                  <span className="tabular-nums">{money.format(Math.abs(changeDue))}</span>
                </div>
              </div>
            )}

            {paymentMethod !== 'cash' && (
              <div className="mt-3">
                <label className="text-sm font-semibold">
                  Amount to Pay ({paymentMethod.toUpperCase()})
                  <input
                    className="mt-2 w-full rounded-lg border border-amber-200/80 px-3 py-3 text-lg outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/40"
                    max={remainingBalance.toFixed(2)}
                    step="0.01"
                    type="number"
                    value={cashReceived}
                    onChange={(event) => setCashReceived(event.target.value)}
                  />
                </label>
              </div>
            )}

            {paymentError && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{paymentError}</p>}

            <div className="mt-4 flex gap-2.5">
              <button
                className="flex-1 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 font-semibold text-amber-900 hover:bg-amber-100 shadow-sm transition"
                type="button"
                onClick={() => {
                  setPaymentError(null);
                  setPaymentOpen(false);
                  setSplitPayments([]);
                }}
              >
                ↩️ Back to Cart
              </button>
              <button
                className="flex-1 rounded-lg bg-amber-600 px-4 py-3 font-semibold text-white hover:bg-amber-700 disabled:opacity-50 shadow-sm transition"
                disabled={busy || (remainingBalance > 0 && (!Number.isFinite(Number(cashReceived)) || Number(cashReceived) <= 0))}
                type="button"
                onClick={() => void submitOrder()}
              >
                {busy
                  ? 'Saving...'
                  : remainingBalance === 0 && appliedExchangeCredit > 0
                    ? `Confirm & Complete Exchange (${money.format(appliedExchangeCredit)})`
                    : Number(cashReceived) < remainingBalance
                      ? `Add Partial Payment (${money.format(Number(cashReceived) || 0)})`
                      : changeDue > 0
                        ? `Confirm & Complete payment (Change Due: ${money.format(changeDue)})`
                        : 'Confirm & Complete payment'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}