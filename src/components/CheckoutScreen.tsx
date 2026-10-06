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
  method: 'cash' | 'card' | 'gcash' | 'account';
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
  paymentMethod: 'cash' | 'card' | 'gcash' | 'account' | 'split';
  cashReceived: number;
  payments: CheckoutOrderPayment[];
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
}

interface CartLine {
  lineId: string;
  product: CheckoutProduct;
  quantity: number;
  unitPrice: number;
}

const DEFAULT_CATEGORIES = [
  'BUTTER',
  'FLOURS',
  'COCOA',
  'CHOCOLATE BAR/CHIPS',
  'SWEETENERS',
  'MILK/DAIRY',
  'CAKE BOARDS',
  'CAKE BOXES',
  'FLAVORINGS',
  'SEASONAL ITEMS',
  'BAKING PANS',
  'CANDLES',
  'DECORATIONS',
  'PASTRY TOOLS',
  'PACKAGING',
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
  const [paymentMethod, setPaymentMethod] = useState<CheckoutOrderPayment['method']>('cash');
  const [splitPayments, setSplitPayments] = useState < CheckoutOrderPayment[] > ([]);
  const [cashReceived, setCashReceived] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const customerDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        customerDropdownRef.current &&
        !customerDropdownRef.current.contains(event.target as Node)
      ) {
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
  const subtotal = cart.reduce((total, line) => total + line.quantity * line.unitPrice, 0);
  const taxAmount = subtotal * taxRate;
  const totalAmount = subtotal + taxAmount;
  const totalPaidSoFar = splitPayments.reduce((sum, p) => sum + p.amount, 0);
  const remainingBalance = Math.max(0, Number((totalAmount - totalPaidSoFar).toFixed(2)));
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
        if (mounted) setScaleReading(reading);
      } catch {
        if (mounted) setScaleReading(null);
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
    if (!activeWeightLine || !scaleReading) return;
    const quantity = scaleReading.grams / (activeWeightLine.product.unit.toLowerCase() === 'kg' ? 1_000 : 1);
    if (quantity <= 0) return;
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
    if (!Number.isFinite(quantity) || quantity <= 0) return;
    setCart((currentCart) =>
      currentCart.map((line) =>
        line.lineId === lineId
          ? { ...line, quantity, unitPrice: resolvePrice(line.product, pricingTierId, quantity) }
          : line
      )
    );
  };

  const submitOrder = async (): Promise<void> => {
    if (orderItems.length === 0 || orderItems.some((item) => item.quantity <= 0)) {
      setMessage('Add a valid quantity before taking payment.');
      return;
    }
    const currentTendered = Number(cashReceived) || remainingBalance;

    if (paymentMethod === 'cash' && (!Number.isFinite(cashTendered) || cashTendered < totalAmount)) {
      setMessage('Cash received must be at least the remaining balance.');
      return;
    }

    const allocatedAmount = paymentMethod === 'cash'
      ? Math.min(cashTendered, remainingBalance)
      : Math.min(currentTendered, remainingBalance);

    const currentPayment: CheckoutOrderPayment = {
      method: paymentMethod,
      amount: allocatedAmount,
      cashReceived: paymentMethod === 'cash' ? cashTendered : undefined,
    };

    // If entered amount is LESS than remaining balance, record partial payment and keep prompting
    if (allocatedAmount < remainingBalance) {
      const updatedSplit = [...splitPayments, currentPayment];
      const newPaid = updatedSplit.reduce((sum, p) => sum + p.amount, 0);
      const newRemaining = Math.max(0, Number((totalAmount - newPaid).toFixed(2)));
      setSplitPayments(updatedSplit);
      setCashReceived(newRemaining.toFixed(2));
      setMessage(`Partial payment of ${money.format(allocatedAmount)} (${paymentMethod.toUpperCase()}) recorded. ${money.format(newRemaining)} remaining.`);
      return;
    }
    // Payment complete (full or final split installment)
    const finalPayments = [...splitPayments, currentPayment];
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
      });
      if (employeeToken && recordEmployeeSale) {
        await recordEmployeeSale(employeeToken, result.orderId);
      }

      setCart([]);
      setCustomerId(null);
      localStorage.removeItem('bakealley_pos_cart');
      localStorage.removeItem('bakealley_pos_customer_id');

      setCashReceived('');
      setSplitPayments([]);
      setPaymentOpen(false);
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : 'Order submission failed.');
    } finally {
      setBusy(false);
    }
  };

  // Payment Options Config with Logos / Visual Badges
  const paymentOptions = [
    { id: 'cash', label: 'Cash', icon: '💵', color: 'border-emerald-500 bg-emerald-50 text-emerald-800' },
    { id: 'card', label: 'Card / POS', icon: '💳', color: 'border-blue-500 bg-blue-50 text-blue-800' },
    { id: 'gcash', label: 'GCash', icon: '📱', color: 'border-sky-500 bg-sky-50 text-sky-800' },
    { id: 'account', label: 'Account', icon: '📋', color: 'border-amber-500 bg-amber-50 text-amber-800' },
  ] as const;

  return (
    <main className="min-h-screen bg-[#FAF6F0] p-6 text-amber-950">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-3">
            <img alt="Bake Alley logo" className="h-9 w-9 rounded-full border border-amber-200/80 object-cover shadow-sm" src={logoUrl} />
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-600">Bake Alley POS</p>
              <h1 className="font-bakery text-3xl font-bold tracking-tight text-amber-950">Checkout</h1>
            </div>
          </div>
          <div ref={customerDropdownRef} className="relative w-full max-w-md sm:w-80">
            <label className="block text-sm font-semibold text-amber-900 mb-1">
              Customer
            </label>
            <div
              className="flex items-center justify-between rounded-lg border border-amber-200/80 bg-white px-3 py-2 text-sm shadow-sm cursor-pointer hover:border-amber-400 focus-within:border-amber-500 focus-within:ring-2 focus-within:ring-amber-500/40"
              onClick={() => setCustomerDropdownOpen((prev) => !prev)}
            >
              <span className="truncate font-medium text-amber-950">
                {!selectedCustomer
                  ? "👤 Retail Walk-in (New Client)"
                  : isWholesaleCustomer
                  ? "🏢 " + selectedCustomer.displayName + " (Wholesale)"
                  : "🔁 " + selectedCustomer.displayName + " (Return Client)"}
              </span>
              <span className="ml-2 text-xs text-amber-600 font-bold">
                {customerDropdownOpen ? '▲' : '▼'}
              </span>
            </div>

            {customerDropdownOpen && (
              <div className="absolute right-0 z-30 mt-1 w-full rounded-xl border border-amber-200 bg-white p-2 shadow-2xl">
                <input
                  type="text"
                  autoFocus
                  placeholder="Search customer name..."
                  value={customerSearchTerm}
                  onChange={(e) => setCustomerSearchTerm(e.target.value)}
                  className="w-full rounded-lg border border-amber-200 px-3 py-1.5 text-xs outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                  onClick={(e) => e.stopPropagation()}
                />
                <div className="mt-2 max-h-56 overflow-y-auto space-y-1">
                  <button
                    type="button"
                    onClick={() => {
                      setCustomerId(null);
                      setCustomerSearchTerm('');
                      setCustomerDropdownOpen(false);
                    }}
                    className={`w-full text-left rounded-lg px-3 py-2 text-xs font-semibold transition ${
                      !selectedCustomer
                        ? 'bg-amber-100 font-bold text-amber-950'
                        : 'hover:bg-amber-50 text-amber-900'
                    }`}
                  >
                    {"👤"} Retail Walk-in (New Client)
                  </button>

                  {filteredCustomers.length === 0 ? (
                    <p className="py-3 text-center text-xs text-amber-600">
                      No matching customers found.
                    </p>
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
                            setCustomerDropdownOpen(false);
                          }}
                          className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs transition ${
                            isSelected
                              ? 'bg-emerald-50 font-bold text-emerald-950'
                              : 'hover:bg-amber-50/80 text-amber-900'
                          }`}
                        >
                          <span className="truncate">
                            {isWholesale ? "🏢" : "🔁"} {customer.displayName}
                          </span>
                          <span
                            className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              isWholesale
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {isWholesale ? 'Wholesale' : 'Return Client'}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Barcode & SKU Search Bar */}
        <section className="relative">
          <label className="sr-only" htmlFor="product-search">Search by barcode or SKU</label>
          <input
            ref={searchInputRef}
            id="product-search"
            autoComplete="off"
            className="w-full rounded-xl border border-amber-200/80 bg-white px-5 py-4 text-lg shadow-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/40"
            placeholder="Scan barcode or search SKU..."
            value={query}
            onChange={(event) => void search(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && results.length > 0) {
                addProduct(results[0]);
              }
            }}
          />
          {results.length > 0 && (
            <div className="absolute z-10 mt-2 grid w-full gap-2 rounded-2xl border border-amber-200/80 bg-white p-2 shadow-xl sm:grid-cols-2">
              {results.slice(0, 8).map((product) => (
                <button
                  key={product.variantId}
                  type="button"
                  className="flex flex-col items-start gap-2 rounded-2xl border border-amber-200/80 bg-white px-4 py-3 text-left transition hover:-translate-y-0.5 hover:border-amber-400 hover:shadow-md"
                  onClick={() => addProduct(product)}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <strong className="text-amber-950">{product.name}</strong>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">{product.unit}</span>
                  </span>
                  <span className="flex w-full items-center justify-between text-sm text-amber-700">
                    <span>{product.sku}</span>
                    {product.soldByWeight && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Sold by weight</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Quick Categories Fast-Key Grid Section */}
        <section className="rounded-2xl border border-amber-200/80 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between border-b border-amber-100 pb-3">
            <h2 className="font-bakery text-lg font-bold text-amber-950">
              {selectedCategory ? `Category: ${selectedCategory.name}` : 'Quick Categories'}
            </h2>
            {selectedCategory && (
              <button
                type="button"
                onClick={() => {
                  setSelectedCategory(null);
                  setCategoryProducts([]);
                }}
                className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-200"
              >
                ← All Categories
              </button>
            )}
          </div>

          {!selectedCategory ? (
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7">
              {categoriesList.length > 0
                ? categoriesList.map((cat) => (
                    <button
                      key={cat.categoryId}
                      type="button"
                      onClick={() => void handleSelectCategory(cat.name, cat.categoryId)}
                      className="flex h-20 flex-col items-center justify-center rounded-xl border border-amber-200/80 bg-amber-50/40 p-2 text-center transition hover:-translate-y-0.5 hover:border-amber-400 hover:bg-amber-100/60 hover:shadow-md"
                    >
                      <span className="font-bakery text-xs font-bold text-amber-950 line-clamp-2">{cat.name}</span>
                    </button>
                  ))
                : DEFAULT_CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => void handleSelectCategory(cat)}
                      className="flex h-20 flex-col items-center justify-center rounded-xl border border-amber-200/80 bg-amber-50/40 p-2 text-center transition hover:-translate-y-0.5 hover:border-amber-400 hover:bg-amber-100/60 hover:shadow-md"
                    >
                      <span className="font-bakery text-xs font-bold text-amber-950 line-clamp-2">{cat}</span>
                    </button>
                  ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {categoryLoading ? (
                <p className="col-span-full py-8 text-center text-xs text-amber-700">Loading products...</p>
              ) : categoryProducts.length === 0 ? (
                <p className="col-span-full py-8 text-center text-xs text-amber-700">
                  No items found under {selectedCategory.name}.
                </p>
              ) : (
                categoryProducts.map((product) => {
                  const unitPrice = resolvePrice(product, pricingTierId, 1);
                  return (
                    <button
                      key={product.variantId}
                      type="button"
                      onClick={() => addProduct(product)}
                      className="flex flex-col justify-between rounded-xl border border-amber-200/80 bg-white p-3 text-left shadow-sm transition hover:border-amber-400 hover:shadow-md"
                    >
                      <div>
                        <h3 className="font-bakery text-xs font-bold text-amber-950 line-clamp-2">{product.name}</h3>
                        <p className="mt-1 font-mono text-[10px] text-amber-700">{product.sku}</p>
                      </div>
                      <div className="mt-3 flex items-center justify-between border-t border-amber-100 pt-2">
                        <span className="font-bold text-amber-900 tabular-nums">{money.format(unitPrice)}</span>
                        <span className="rounded-md bg-amber-600 px-2 py-0.5 text-[10px] font-semibold text-white">+ Add</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </section>

        {/* Current Transaction Table & Totals */}
        <section className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <div className="overflow-hidden rounded-xl border border-amber-200/80 bg-white shadow-sm">
            <div className="border-b border-amber-200/80 px-5 py-4"><h2 className="font-semibold">Current transaction</h2></div>
            {cart.length === 0 ? (
              <p className="px-5 py-16 text-center text-amber-700">Scan an item or tap a category to begin.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-amber-50/60 text-xs uppercase tracking-wide text-amber-700">
                    <tr><th className="px-5 py-3">Item</th><th className="px-3 py-3">Qty</th><th className="px-3 py-3">Price</th><th className="px-5 py-3 text-right">Total</th><th><span className="sr-only">Remove</span></th></tr>
                  </thead>
                  <tbody>
                    {cart.map((line) => (
                      <tr key={line.lineId} className="border-t border-amber-100/60">
                        <td className="px-5 py-4"><strong>{line.product.name}</strong><div className="text-xs text-amber-700">{line.product.sku}</div></td>
                        <td className="px-3 py-4"><input aria-label={`Quantity for ${line.product.name}`} className="w-24 rounded border border-amber-200/80 px-2 py-1" min="0.0001" step="0.0001" type="number" value={line.quantity} onChange={(event) => updateQuantity(line.lineId, Number(event.target.value))} /></td>
                        <td className="px-3 py-4 tabular-nums">{money.format(line.unitPrice)} / {line.product.unit}</td>
                        <td className="px-5 py-4 text-right font-semibold tabular-nums">{money.format(line.quantity * line.unitPrice)}</td>
                        <td className="pr-4"><button className="text-amber-600 hover:text-red-600" title="Remove item" type="button" onClick={() => setCart((currentCart) => currentCart.filter((item) => item.lineId !== line.lineId))}>×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <aside className="space-y-4">
            {scaleEnabled && (
              <div className="rounded-xl border border-amber-200/80 bg-white p-5 shadow-sm">
                <div className="mb-5 flex items-center justify-between"><h2 className="font-semibold">Scale</h2><span className={`rounded-full px-2 py-1 text-xs font-semibold ${scaleReading?.stable ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{activeWeightLine ? (scaleReading?.stable ? 'Stable' : 'Waiting') : 'Idle'}</span></div>
                <p className="text-3xl font-bold tabular-nums">{activeWeightLine && scaleReading ? formatWeight(scaleReading.grams) : '0 g'}</p>
                <p className="mt-1 text-sm text-amber-700">{activeWeightLine ? `Reading for ${activeWeightLine.product.name}` : 'Add a weight-based item to read the scale.'}</p>
              </div>
            )}
            <div className="rounded-xl border border-amber-200/80 bg-white p-5 shadow-sm">
              <div className="flex justify-between text-sm text-amber-800"><span>Subtotal</span><span className="font-semibold tabular-nums">{money.format(subtotal)}</span></div>
              <div className="mt-2 flex justify-between text-sm text-amber-800"><span>Tax</span><span className="font-semibold tabular-nums">{money.format(taxAmount)}</span></div>
              <div className="mt-4 flex justify-between border-t border-amber-200/80 pt-4 text-xl font-bold"><span>Total</span><span className="tabular-nums">{money.format(totalAmount)}</span></div>
              <button className="mt-5 w-full rounded-lg bg-amber-600 px-4 py-3 font-semibold text-white shadow-sm hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50" disabled={cart.length === 0 || busy || isClockedIn === false} type="button" onClick={() => setPaymentOpen(true)}>{isClockedIn === false ? 'Clock-in Required to Take Payment' : 'Take payment'}</button>
            </div>
          </aside>
        </section>

        {message && <p className="rounded-lg bg-amber-950 px-4 py-3 text-sm text-white" role="status">{message}</p>}
      </div>

      {/* Payment Modal with Logged Options (Cash, Card, GCash, Account) */}
      {paymentOpen && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-amber-950/50 p-4" role="presentation">
          <section aria-labelledby="payment-title" aria-modal="true" className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl space-y-4" role="dialog">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-amber-600">Payment</p>
                <h2 className="font-bakery mt-1 text-2xl font-bold tabular-nums" id="payment-title">{money.format(totalAmount)}</h2>
                {splitPayments.length > 0 && (
                  <p className="text-xs font-semibold text-amber-800 mt-1">
                    Remaining Needed: <span>{money.format(remainingBalance)}</span>
                  </p>
                )}
              </div>
              <button aria-label="Close payment dialog" className="text-2xl text-amber-600 hover:text-amber-900" type="button" onClick={() => { setPaymentOpen(false); setSplitPayments([]); }}>×</button>
            </div>

            {/* Recorded Partial Payments List */}
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
                          const newRemaining = totalAmount - updated.reduce((s, x) => s + x.amount, 0);
                          setCashReceived(newRemaining.toFixed(2));
                        }}
                      >x</button>
                    </div>
                  </div>
                ))}
              </div>
            )}


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
                    className={`flex items-center gap-2.5 rounded-xl border p-3 text-left transition ${
                      paymentMethod === opt.id
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

            {paymentMethod === 'cash' && (
              <div className="mt-3">
                <label className="text-sm font-semibold">
                  Cash received
                  <input
                    autoFocus
                    className="mt-2 w-full rounded-lg border border-amber-200/80 px-3 py-3 text-lg outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/40"
                    min={remainingBalance.toFixed(2)}
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
                <label className="text-sm font-semibold"> Amount to Pay ({paymentMethod.toUpperCase()})
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
                disabled={busy || (paymentMethod === 'cash' && changeDue < 0)}
                type="button"
                onClick={() => void submitOrder()}
              >
                {busy ? 'Saving...' : Number(cashReceived) < remainingBalance ? `Add Partial Payment (${money.format(Number(cashReceived) || 0)})` : 'Confirm & Complete payment'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}