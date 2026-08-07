package com.demo.core.models.totc;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.annotation.PostConstruct;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class ImageTextModel {

    @ValueMapValue private String title;
    @ValueMapValue private String titleAccent;
    @ValueMapValue private String body;
    @ValueMapValue private String ctaLabel;
    @ValueMapValue private String ctaLink;
    @ValueMapValue private String image;
    @ValueMapValue private String imageAlt;

    @ValueMapValue @Default(booleanValues = false) private boolean playIcon;

    @ValueMapValue @Default(values = "right")  private String imageSide;
    @ValueMapValue @Default(values = "navy")   private String titleColor;
    @ValueMapValue @Default(values = "orange") private String accentColor;
    @ValueMapValue @Default(values = "rounded") private String mediaStyle;
    @ValueMapValue @Default(values = "lg") private String padTop;
    @ValueMapValue @Default(values = "lg") private String padBottom;

    @ChildResource
    private List<Bullet> bullets;

    @PostConstruct
    protected void init() {
        if (bullets == null) {
            bullets = Collections.emptyList();
        } else {
            List<Bullet> filtered = new ArrayList<>();
            for (Bullet b : bullets) {
                if (b != null && b.hasContent()) {
                    filtered.add(b);
                }
            }
            bullets = Collections.unmodifiableList(filtered);
        }
    }

    public String getTitle() { return title; }
    public String getTitleAccent() { return titleAccent; }
    public String getBody() { return body; }
    public String getCtaLabel() { return ctaLabel; }
    public String getCtaLink() { return ctaLink; }
    public String getImage() { return image; }
    public String getImageAlt() { return imageAlt; }
    public boolean isPlayIcon() { return playIcon; }
    public String getImageSide() { return imageSide; }
    public String getTitleColor() { return titleColor; }
    public String getAccentColor() { return accentColor; }
    public String getMediaStyle() { return mediaStyle; }
    public String getPadTop() { return padTop; }
    public String getPadBottom() { return padBottom; }
    public List<Bullet> getBullets() { return bullets; }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(title)
                || StringUtils.isNotBlank(titleAccent)
                || StringUtils.isNotBlank(body)
                || StringUtils.isNotBlank(image)
                || !bullets.isEmpty();
    }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class Bullet {
        @ValueMapValue private String text;
        @ValueMapValue @Default(values = "pink") private String iconColor;

        public String getText() { return text; }
        public String getIconColor() { return iconColor; }

        public boolean hasContent() { return StringUtils.isNotBlank(text); }
    }
}
