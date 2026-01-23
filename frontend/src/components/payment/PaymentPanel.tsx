import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";

// 充值套餐配置
const RECHARGE_PACKAGES = [
  { price: 10, credits: 2000, bonus: null, tag: "首充翻倍" },
  { price: 30, credits: 6300, bonus: "送5%", tag: "首充翻倍" },
  { price: 50, credits: 10500, bonus: "送5%", tag: "首充翻倍" },
  { price: 100, credits: 22400, bonus: "送12%", tag: "首充翻倍" },
  { price: 200, credits: 48000, bonus: "送5%", tag: "首充翻倍" },
  { price: 500, credits: 130000, bonus: "送30%", tag: "首充翻倍" },
];

// 积分兑换比例：1元 = 100积分
const CREDITS_PER_YUAN = 100;

interface PaymentPanelProps {
  onBack: () => void;
}

const PaymentPanel: React.FC<PaymentPanelProps> = ({ onBack }) => {
  const [selectedPackage, setSelectedPackage] = useState<number | null>(null);
  const [customCredits, setCustomCredits] = useState<string>("1200");

  // 计算自定义充值金额
  const customAmount = useMemo(() => {
    const credits = parseInt(customCredits) || 0;
    return Math.ceil(credits / CREDITS_PER_YUAN);
  }, [customCredits]);

  // 当前选中的支付金额
  const currentPayAmount = useMemo(() => {
    if (selectedPackage !== null) {
      return RECHARGE_PACKAGES[selectedPackage].price;
    }
    return customAmount;
  }, [selectedPackage, customAmount]);

  const handlePackageSelect = (index: number) => {
    setSelectedPackage(index);
  };

  const handleCustomInput = (value: string) => {
    // 只允许数字
    const numValue = value.replace(/\D/g, "");
    setCustomCredits(numValue);
    setSelectedPackage(null); // 取消套餐选择
  };

  const handlePayment = () => {
    // TODO: 实现支付逻辑
    console.log("发起支付:", {
      amount: currentPayAmount,
      credits:
        selectedPackage !== null
          ? RECHARGE_PACKAGES[selectedPackage].credits
          : parseInt(customCredits) || 0,
    });
  };

  return (
    <div className='pb-6'>
      {/* 标题栏带返回按钮 */}
      <div className='flex items-center gap-3 pt-4 pb-6 border-b border-slate-100'>
        <button
          onClick={onBack}
          className='p-1.5 rounded-lg hover:bg-slate-100 transition-colors'
        >
          <ArrowLeft className='w-5 h-5 text-slate-500' />
        </button>
        <h3 className='text-lg font-medium text-slate-800'>工作区</h3>
      </div>

      <div className='flex gap-4 mt-6'>
        {/* 左侧：套餐选择 */}
        <div className='flex-1'>
          {/* 套餐网格 */}
          <div className='grid grid-cols-3 gap-3 mb-3'>
            {RECHARGE_PACKAGES.map((pkg, index) => (
              <button
                key={pkg.price}
                onClick={() => handlePackageSelect(index)}
                className={cn(
                  "relative p-4 rounded-xl border-2 text-left transition-all",
                  selectedPackage === index
                    ? "border-blue-400 bg-blue-50/50"
                    : "border-slate-200 bg-white hover:border-slate-300"
                )}
              >
                <div className='text-2xl font-semibold text-slate-800'>
                  ¥{pkg.price}
                </div>
                <div className='text-sm text-slate-500 mt-1'>
                  {pkg.credits.toLocaleString()}
                  <span className='text-xs'>积分</span>
                </div>
                <div className='flex items-center gap-1.5 mt-2'>
                  <span className='px-2 py-0.5 text-xs rounded-full bg-orange-100 text-orange-600'>
                    {pkg.tag}
                  </span>
                  {pkg.bonus && (
                    <span className='px-2 py-0.5 text-xs rounded-full bg-purple-100 text-purple-600'>
                      {pkg.bonus}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>

          {/* 自定义充值 */}
          <div className='text-sm font-medium text-slate-700 mb-2'>
            自定义充值积分
          </div>
          <div className='flex items-center gap-4'>
            <div className='flex-1 relative'>
              <input
                type='text'
                value={customCredits}
                onChange={(e) => handleCustomInput(e.target.value)}
                className={cn(
                  "w-full px-4 py-3 text-2xl font-semibold border-2 rounded-xl focus:outline-none transition-colors",
                  selectedPackage === null
                    ? "border-slate-200 bg-slate-100/30"
                    : "border-slate-200 focus:border-blue-400"
                )}
                placeholder='输入积分数量'
              />
            </div>
            <div className='text-sm text-slate-500'>
              需要支付金额：
              <span className='text-lg font-semibold text-slate-800 pt-4'>
                ¥{customAmount}
              </span>
            </div>
          </div>
        </div>

        {/* 右侧：二维码支付 */}
        <div className='w-[200px] shrink-0'>
          <div className='flex items-center justify-end gap-2 text-xs text-slate-500 '>
            <img
              src='/wechat-pay.svg'
              alt='微信'
              className='w-4 h-4'
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
            <img
              src='/alipay.svg'
              alt='支付宝'
              className='w-4 h-4'
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          </div>

          {/* 二维码区域 */}
          <div className='w-full aspect-square rounded-xl border-2 border-slate-200 bg-slate-50 flex items-center justify-center'>
            <span className='text-slate-400'>二维码</span>
          </div>

          {/* 支付按钮 */}
          <Button
            onClick={handlePayment}
            className='w-full mt-4 h-12 rounded-xl text-base border-2 border-slate-200 bg-white text-slate-700 hover:bg-blue-50'
            variant='outline'
          >
            微信支付
          </Button>
          <Button
            onClick={handlePayment}
            className='w-full mt-4 h-12 rounded-xl text-base border-2 border-slate-200 bg-white text-slate-700 hover:bg-blue-50'
            variant='outline'
          >
            支付宝支付
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PaymentPanel;
