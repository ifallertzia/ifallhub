class MovieboxTui < Formula
  VERSION = "0.1.26"
  MACOS_SHA256 = "fd7bce0200195ad38fe4b55d24f2f6fa6f7c53fe66ec58dfc6683ad71604bb36"
  LINUX_X64_SHA256 = "a2a856840d92c573f76f5b7c7459a1af2f68d9f0b3f935e15d4977b98eec5a41"
  LINUX_ARM64_SHA256 = "293892877edb86748ccd2efd50d8b063c6d248cd9400b917c669c74681562b14"

  desc "Stream movies, shows, anime, and live TV from your terminal"
  homepage "https://github.com/mesamirh/MovieBox-Tui"
  version VERSION
  license any_of: ["MIT", "Apache-2.0"]

  on_macos do
    url "https://github.com/mesamirh/MovieBox-Tui/releases/download/v#{VERSION}/MovieBox_macOS_Universal.tar.gz"
    sha256 MACOS_SHA256
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/mesamirh/MovieBox-Tui/releases/download/v#{VERSION}/MovieBox_Linux_arm64.tar.gz"
      sha256 LINUX_ARM64_SHA256
    else
      url "https://github.com/mesamirh/MovieBox-Tui/releases/download/v#{VERSION}/MovieBox_Linux_x64.tar.gz"
      sha256 LINUX_X64_SHA256
    end
  end

  def install
    bin.install "moviebox-tui"
  end

  test do
    system "#{bin}/moviebox-tui", "--version"
  end
end
