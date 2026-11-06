import io

from PIL import Image

from app.services import logo_overlay as LO


def _png(size, colour):
    out = io.BytesIO()
    Image.new("RGBA", size, colour).save(out, "PNG")
    return out.getvalue()


def _jpeg(size, colour):
    out = io.BytesIO()
    Image.new("RGB", size, colour).save(out, "JPEG")
    return out.getvalue()


def test_the_logo_lands_in_the_chosen_corner_and_leaves_the_rest_of_the_picture_alone():
    done = LO.place_logo(_jpeg((400, 500), (255, 255, 255)), _png((100, 50), (255, 0, 0, 255)), "bottom_right", 20)
    im = Image.open(io.BytesIO(done)).convert("RGB")
    assert im.size == (400, 500)
    r, g, b = im.getpixel((390 - 20, 490 - 10))  # inside the bottom-right logo
    assert r > 200 and g < 80 and b < 80
    assert im.getpixel((10, 10))[0] > 240 and im.getpixel((10, 10))[1] > 240  # top-left untouched


def test_a_clear_background_in_the_logo_lets_the_picture_show_through():
    done = LO.place_logo(_jpeg((300, 300), (0, 0, 255)), _png((100, 100), (255, 255, 255, 0)), "top_left", 20)
    im = Image.open(io.BytesIO(done)).convert("RGB")
    assert im.getpixel((20, 20))[2] > 200  # still blue where the logo is fully transparent


def test_an_unreadable_logo_gives_no_picture_so_the_original_is_kept():
    assert LO.place_logo(_jpeg((100, 100), (0, 0, 0)), b"not an image") is None


def test_corner_and_size_are_kept_in_range():
    assert LO.clean_corner("somewhere") == "bottom_right" and LO.clean_corner("top_left") == "top_left"
    assert LO.clean_size(500) == LO.SIZE_MAX and LO.clean_size(1) == LO.SIZE_MIN and LO.clean_size("x") == LO.SIZE_DEFAULT
